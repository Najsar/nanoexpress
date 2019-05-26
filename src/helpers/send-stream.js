// Code from https://github.com/uNetworking/uWebSockets.js/blob/master/examples/VideoStreamer.js
// And Adapted to be used
// and create method for easy and clean
// code and usefulness

import fs from 'fs';
import promisify from './promisify';
import toArrayBuffer from './to-array-buffer';

const onAbortedOrFinishedResponse = (res, readStream) =>
  new Promise((resolve, reject) => {
    if (res.id === -1) {
      reject(
        new Error('[Server]: Error, Reject called twice for the same res!')
      );
    } else {
      readStream.destroy();
      reject(new Error('[Server]: Error, Stream was closed'));
    }
    res.id = -1;
    if (res.___status) {
      res.writeStatus(res.___status);
    }
    if (res.___headers) {
      for (const header in res.___headers) {
        res.writeHeader(header, res.___headers[header]);
      }
    }
    resolve(readStream);
  });

const bytes = 'bytes=';
export default (req, res) => {
  const { headers } = req;
  return async (fileName) => {
    let fileSize = (await promisify(fs.stat, fileName)).size;

    // Allow partial content
    let start = 0,
      end = fileSize - 1;

    if (headers.range) {
      const parts = headers.range.replace(bytes, '').split('-');
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : end;
      headers['accept-ranges'] = 'bytes';
      headers['content-range'] = `bytes ${start}-${end}/${fileSize}`;
      fileSize = end - start + 1;
      res.writeStatus('206 Partial Content');
    }

    // for size = 0
    if (end < 0) {
      end = 0;
    }

    const readStream = fs.createReadStream(fileName, { start, end });

    const result = await new Promise((resolve, reject) => {
      readStream
        .on('data', (chunk) => {
          const chunkArray = toArrayBuffer(chunk);
          const lastOffset = res.getWriteOffset();
          const [ok, done] = res.tryEnd(chunkArray, fileSize);

          if (done) {
            onAbortedOrFinishedResponse(res, readStream)
              .then(resolve)
              .catch(reject);
          } else if (!ok) {
            readStream.pause();

            res.chunkArray = chunkArray;
            res.chunkOffset = lastOffset;

            res.onWritable((offset) => {
              const [ok, done] = res.tryEnd(
                res.chunkArray.slice(offset - res.chunkOffset),
                fileSize
              );
              if (done) {
                onAbortedOrFinishedResponse(res, readStream)
                  .then(resolve)
                  .catch(reject);
              } else if (ok) {
                readStream.resume();
              }
              return ok;
            });
          }
        })
        .on('error', () => {
          reject(
            new Error(
              '[Server]: Unhandled read error from Node.js, you need to handle this!'
            )
          );
        });

      res.onAborted(() => {
        onAbortedOrFinishedResponse(res, readStream)
          .then(resolve)
          .catch(reject);
      });
    });

    // Maybe we just return?
    return result;
  };
};
