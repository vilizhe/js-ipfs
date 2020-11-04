'use strict'

const normaliseInput = require('ipfs-core-utils/src/files/normalise-input')
const CID = require('cids')
const bidiToDuplex = require('../utils/bidi-to-duplex')
const withTimeoutOption = require('ipfs-core-utils/src/with-timeout-option')

function sendDirectory (index, source, path, mode, mtime) {
  const message = {
    index,
    type: 'DIRECTORY',
    path
  }

  if (mtime) {
    message.mtime = mtime
  }

  if (mode != null) {
    message.mode = mode
  }

  source.push(message)
}

async function sendFile (index, source, content, path, mode, mtime) {
  for await (const buf of content) {
    const message = {
      index,
      type: 'FILE',
      path
    }

    if (mtime) {
      message.mtime = mtime
    }

    if (mode != null) {
      message.mode = mode
    }

    message.content = new Uint8Array(buf, buf.byteOffset, buf.byteLength)

    source.push(message)
  }

  // signal that the file data has finished
  const message = {
    index,
    type: 'FILE',
    path
  }

  source.push(message)
}

async function sendFiles (stream, source, options) {
  let i = 1

  for await (const { path, content, mode, mtime } of normaliseInput(stream)) {
    const index = i
    i++

    if (content) {
      await sendFile(index, source, content, path, mode, mtime)
    } else {
      sendDirectory(index, source, path, mode, mtime)
    }
  }
}

module.exports = function grpcAddAll (grpc, service, opts = {}) {
  opts = opts || {}

  async function * addAll (stream, options = {}) {
    const {
      source,
      sink
    } = bidiToDuplex(grpc, service, {
      host: opts.url,
      debug: Boolean(process.env.DEBUG)
    })

    setTimeout(() => {
      sendFiles(stream, source, options)
        .catch(err => {
          source.end(err)
        })
        .finally(() => {
          source.end()
        })
    }, 0)

    for await (const result of sink) {
      // received progress result
      if (result.type === 'PROGRESS') {
        if (options.progress) {
          options.progress(result.bytes, result.path)
        }

        continue
      }

      // received file/dir import result
      yield {
        path: result.path,
        cid: new CID(result.cid),
        mode: result.mode,
        mtime: {
          secs: result.mtime,
          nsecs: result.mtimeNsecs
        },
        size: result.size
      }
    }
  }

  return withTimeoutOption(addAll)
}
