"use strict";
var async = require('async')
  , ngrok = require('ngrok')
  , git = require('git-rev')
  , SauceLabs = require('saucelabs')
  , TestServer = require('./websocket-server')

var config = require('./config')
  , saucelabs = new SauceLabs({
    username: config.username,
    password: config.password
  })

var port = 8000

var startTest = function(config, done) {
  console.log('----------')
  console.log('# starting tests ' + config.platform.join(' '))

  var testServer = new TestServer({ port: config.port })
    , context = { url: null, jobId: null, result: null, testIds: null }

  async.series([
    
    // Start server and ngrok
    testServer.start.bind(testServer),
    (next) => { 
      console.log('> server started')
      ngrok.connect(config.port, (err, url) => {
        if (err) return next(err)
        context.url = 'http' + url.slice('https'.length) // replacing https by http
        console.log('> ngrok connected ' + context.url)
        next(err)
      }) 
    },

    // Start the tests
    (next) => {
      saucelabs.send({
        method: 'POST',
        path: ':username/js-tests',
        data: {
          platforms: [config.platform],
          url: context.url,
          framework: 'mocha'
        }
      }, (err, resp) => {
        if (err) return next(err)
        console.log('> tests started')
        context.testIds = resp['js tests']
        next(null)
      })

    },

    // Fetch job id
    (next) => {
      var monitorJob = () => {
        saucelabs.send({
          method: 'POST',
          path: ':username/js-tests/status',
          data: { 'js tests': context.testIds }
        }, (err, resp) => {
          if (err) return next(err)
          if (resp.completed === false) {
            setTimeout(monitorJob, 5000)
          } else {
            context.result = resp['js tests'][0].result
            context.jobId = resp['js tests'][0].job_id
            console.log('> [fail : ' + context.result.failures + ']' 
              + '[pass : ' + context.result.passes + ']')
            next()
          }
        })
      }
      monitorJob()
    },

    // Report test failure / success
    (next) => saucelabs.updateJob(context.jobId, { build: config.build }, (err, resp) => next(err)),

    testServer.stop.bind(testServer),
    (next) => {
      console.log('> server stopped, report sent')
      ngrok.disconnect(context.url)
      next()
    }

  ], done)
}

// <os>, <api_name>, <short_version>
var platforms = [
  /*['Linux', 'android', '5.1'],
  ['Linux', 'android', '5.0'],
  ['Linux', 'android', '4.4'],
  ['Linux', 'android', '4.3'],
  ['Linux', 'android', '4.2'],
  ['Linux', 'android', '4.1'],
  ['Linux', 'android', '4.0'],

  ['Mac 10.10', 'firefox', '41'],
  ['Linux', 'firefox', '40'],
  ['Linux', 'firefox', '39'],

  ['Linux', 'chrome', '45'],
  ['Mac 10.10', 'chrome', '44'],
  ['Windows 7', 'chrome', '43'],

  ['Windows 10', 'internet explorer', '11'],
  ['Windows 8', 'internet explorer', '10'],
  ['Windows 7', 'internet explorer', '9'],
  ['Windows XP', 'internet explorer', '8'],*/

  ['Mac 10.10', 'iphone', '9.3'],
  /*['Mac 10.10', 'iphone', '8.4'],
  ['Mac 10.10', 'iphone', '7.1'],
  ['Mac 10.8', 'iphone', '6.1'],
  ['Mac 10.8', 'iphone', '5.1'],

  ['Windows XP', 'opera', '12'],
  ['Windows XP', 'opera', '11'],

  ['Mac 10.10', 'safari', '8.1'],
  ['Mac 10.9', 'safari', '7.0'],
  ['Mac 10.8', 'safari', '6.0'],
  ['Mac 7', 'safari', '5.0']*/
]

git.long((sha) => {

  async.eachSeries(platforms, 
    (platform, next) => startTest({ platform: platform, build: sha, port: port++ }, next),

    (err) => {
      if (err) throw err
      process.exit(0)
    }
  )

})