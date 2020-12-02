const http = require('http');
const https = require('https');
const moment = require('moment');
const jwt = require('jsonwebtoken');
const uuidv4 = require('uuid').v4;

function createServer(opts, fn) {
  if (opts.ssl) {
    const s1 = https.createServer(opts.ssl, (req, res) => {
      return fn(req, res, true)
    });
    return {
      listen: (lopts) => {
        console.log(`[${opts.type}] ${moment().format('YYYY-MM-DD HH:mm:ss.SSS')} - Proxy listening on https://${lopts.hostname}:${lopts.port}`);
        return s1.listen(lopts.port, lopts.hostname);
      },
      close: () => s1.close()
    };
  } else {
    const s1 = http.createServer((req, res) => {
      return fn(req, res, false)
    });
    return {
      listen: (lopts) => {
        console.log(`[${opts.type}] ${moment().format('YYYY-MM-DD HH:mm:ss.SSS')} - Proxy listening on http://${lopts.hostname}:${lopts.port}`);
        return s1.listen(lopts.port, lopts.hostname);
      },
      close: () => s1.close()
    };
  }
}

function writeError(code, err, ctype, res, args) {
  const _headers = { 'Content-Type': ctype };
  res.writeHead(code, _headers);
  res.write(err);
  res.end();
}

function InternalProxy(opts) {

  opts.type = 'INTERNAL-PROXY'

  const server = createServer(opts, (req, res, secure) => {

    const ctx = opts.context();

    try {
      const args = {};

      if (opts.enableOriginCheck && (req.socket.localAddress !== '127.0.0.1' && req.socket.localAddress !== 'localhost' && req.socket.localAddress.indexOf('127.0.0.1') === -1)) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.write(JSON.stringify({ error: 'bad origin' }));
        res.end();
        return;
      }

      const domain = req.headers.host.split(':')[0];
      const isHandledByOtoroshi = domain.indexOf(ctx.OTOROSHI_DOMAIN) > -1;
      
      const requestId = uuidv4();
      let options = {
        host: ctx.OTOROSHI_HOST,
        port: ctx.OTOROSHI_PORT,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          'Otoroshi-Client-Id': ctx.CLIENT_ID,
          'Otoroshi-Client-Secret': ctx.CLIENT_SECRET,
        },
        cert: ctx.CLIENT_CERT,
        key: ctx.CLIENT_KEY,
        ca: ctx.CLIENT_CA
      };
      req.setEncoding('utf8');
      if (!isHandledByOtoroshi) {
        // just proxy here and not fail ???
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.write(JSON.stringify({ error: 'not an otoroshi request' }));
        res.end();
        return;
      }

      console.log(`[INTERNAL-PROXY] ${moment().format('YYYY-MM-DD HH:mm:ss.SSS')} - ${requestId} - HTTP/${req.httpVersion} - ${req.method} - ${secure ? 'https' : 'http'}://${domain}${req.url}`);

      // options.agent = new https.Agent(options);
      const forwardReq = https.request(options, (forwardRes) => {
        const headersOut = { ...forwardRes.headers };      
        res.writeHead(forwardRes.statusCode, headersOut);
        forwardRes.setEncoding('utf8');
        let ended = false;
        forwardRes.on('data', (chunk) => res.write(chunk));
        forwardRes.on('close', () => {
          res.end();
          if (!ended) {
            ended = true;
          }
        });
        forwardRes.on('end', () => {
          res.end();
          if (!ended) {
            ended = true;
          }
        });
      }).on('error', (err) => {
        console.log(`[INTERNAL-PROXY] ${moment().format('YYYY-MM-DD HH:mm:ss.SSS')} Error while forwarding request`, err);
        if (err.type === 'ProxyError') {
          try {
            writeError(err.status, err.body, err.ctype, res, args);
          } catch (err2) {
            console.log(`[INTERNAL-PROXY] ${moment().format('YYYY-MM-DD HH:mm:ss.SSS')} Could not send error response: `, err2, {});
          }
        } else {
          writeError(502, `{"error": "Internal error", "type":"INTERNAL-PROXY", "message":"${err.message}" }`, 'application/json', res, args);
        }
      });
      const contentLength = parseInt(req.headers['Content-Length'] || req.headers['content-length'] || '0', 10);
      const hasContentLength = contentLength > 0;
      const isChunked = (req.headers['Transfer-Encoding'] || req.headers['transfer-encoding'] || 'none') === 'chunked';
      if (hasContentLength || isChunked) {
        req.on('data', (chunk) => forwardReq.write(chunk));
        req.on('close', () => forwardReq.end());
        req.on('end', () => forwardReq.end());
      } else {
        forwardReq.end();
      }
    } catch (_error) {
      console.log(`[INTERNAL-PROXY] ${moment().format('YYYY-MM-DD HH:mm:ss.SSS')} http request to service raised: `, _error, {});
      if (_error.type === 'ProxyError') {
        try {
          writeError(_error.status, _error.body, _error.ctype, res, args);
        } catch (_error2) {
          console.log(`[INTERNAL-PROXY] ${moment().format('YYYY-MM-DD HH:mm:ss.SSS')} Could not send error response: `, _error2, {});
        }
      } else {
        try {
          writeError(502, `{"error": "Internal error", "type":"INTERNAL-PROXY", "message":"${_error.message}" }`, 'application/json', res, args);
        } catch (_error2) {
          console.log(`[INTERNAL-PROXY] ${moment().format('YYYY-MM-DD HH:mm:ss.SSS')} Could not send error response: `, _error2, {});
        }
      }
    }
  });

  return server;
}

function ExternalProxy(opts) {

  opts.type = 'EXTERNAL-PROXY'
  
  const _ctx = opts.context();

  const server = createServer({ ...opts, ssl: {
    key: _ctx.BACKEND_KEY, 
    cert: _ctx.BACKEND_CERT, 
    ca: _ctx.BACKEND_CA, 
    // requestCert: true, 
    rejectUnauthorized: true,
  } }, (req, res, secure) => { 
    
    const ctx = opts.context();

    try {
      const args = {};

      if (opts.enableOriginCheck && (req.socket.localAddress === '127.0.0.1' || req.socket.localAddress === 'localhost' || req.socket.localAddress.indexOf('127.0.0.1') > -1)) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.write(JSON.stringify({ error: 'bad origin' }));
        res.end();
        return;
      }
    
      const requestId = uuidv4();
      const stateToken = req.headers['otoroshi-state'];
      const claimToken = req.headers['otoroshi-claim'];
      const domain = req.headers.host.split(':')[0];

      if (claimToken && stateToken) { 
        try {
          const stateTokenIsJwt = stateToken.split('.').legnth === 3;
          const state = stateTokenIsJwt ? jwt.verify(stateToken, ctx.TOKEN_SECRET) : stateToken;
          const claims = jwt.verify(claimToken, ctx.TOKEN_SECRET);
          args.claims = JSON.stringify(claims);
          if (stateTokenIsJwt) {
            const jwtTokenRaw = { "state-resp": args.state, aud: "Otoroshi", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 10 };
            const jwtToken = jwt.sign(jwtTokenRaw, ctx.TOKEN_SECRET, { algorithm: 'HS512' });
            args.state = jwtToken
          } else {
            args.state = state;
          }
        } catch(err) {
          return writeError(400, `{"error":"bad tokens"}`, 'application/json', res, args);
        }
      } else {
        return writeError(400, `{"error":"no tokens"}`, 'application/json', res, args);
      }

      // if (!req.socket.getPeerCertificate().subject) {
      //   return writeError(400, `{"error":"bad client cert"}`, 'application/json', res, args);
      // }

      const options = {
        host: '127.0.0.1',
        port: ctx.LOCAL_PORT,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers
        }
      };
      req.setEncoding('utf8');

      console.log(`[EXTERNAL-PROXY] ${moment().format('YYYY-MM-DD HH:mm:ss.SSS')} - ${requestId} - HTTP/${req.httpVersion} - ${req.method} - ${secure ? 'https' : 'http'}://${domain}${req.url}`);

      const forwardReq = http.request(options, (forwardRes) => {
        const headersOut = { ...forwardRes.headers, 'otoroshi-claim': args.claims, 'otoroshi-state-resp': args.state }; 
        res.writeHead(forwardRes.statusCode, headersOut);
        forwardRes.setEncoding('utf8');
        let ended = false;
        forwardRes.on('data', (chunk) => res.write(chunk));
        forwardRes.on('close', () => {
          res.end();
          if (!ended) {
            ended = true;
          }
        });
        forwardRes.on('end', () => {
          res.end();
          if (!ended) {
            ended = true;
          }
        });
      }).on('error', (err) => {
        console.log(`[EXTERNAL-PROXY] ${moment().format('YYYY-MM-DD HH:mm:ss.SSS')} Error while forwarding request`, err);
        if (err.type === 'ProxyError') {
          try {
            writeError(err.status, err.body, err.ctype, res, args);
          } catch (err2) {
            console.log(`[EXTERNAL-PROXY] ${moment().format('YYYY-MM-DD HH:mm:ss.SSS')} Could not send error response: `, err2, {});
          }
        } else {
          writeError(502, `{"error": "EXTERNAL error", "type":"EXTERNAL-PROXY", "message":"${err.message}" }`, 'application/json', res, args);
        }
      });
      const contentLength = parseInt(req.headers['Content-Length'] || req.headers['content-length'] || '0', 10);
      const hasContentLength = contentLength > 0;
      const isChunked = (req.headers['Transfer-Encoding'] || req.headers['transfer-encoding'] || 'none') === 'chunked';
      if (hasContentLength || isChunked) {
        req.on('data', (chunk) => forwardReq.write(chunk));
        req.on('close', () => forwardReq.end());
        req.on('end', () => forwardReq.end());
      } else {
        forwardReq.end();
      }
    } catch (_error) {
      console.log(`[EXTERNAL-PROXY] ${moment().format('YYYY-MM-DD HH:mm:ss.SSS')} http request to service raised: `, _error, {});
      if (_error.type === 'ProxyError') {
        try {
          writeError(_error.status, _error.body, _error.ctype, res, args);
        } catch (_error2) {
          console.log(`[EXTERNAL-PROXY] ${moment().format('YYYY-MM-DD HH:mm:ss.SSS')} Could not send error response: `, _error2, {});
        }
      } else {
        try {
          writeError(502, `{"error": "EXTERNAL error", "type":"EXTERNAL-PROXY", "message":"${_error.message}" }`, 'application/json', res, args);
        } catch (_error2) {
          console.log(`[EXTERNAL-PROXY] ${moment().format('YYYY-MM-DD HH:mm:ss.SSS')} Could not send error response: `, _error2, {});
        }
      }
    }
  });

  return server;
}

exports.InternalProxy = InternalProxy;
exports.ExternalProxy = ExternalProxy;