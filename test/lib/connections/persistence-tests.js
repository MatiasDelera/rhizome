"use strict";
var assert = require('assert')
  , fs = require('fs')
  , async = require('async')
  , rimraf = require('rimraf')
  , fakeredis = require('fakeredis')
  , persistence = require('../../../lib/connections/persistence')
  , helpers = require('../../helpers-backend')


var testSuite = (store, connectionExists) => {

  describe('connectionInsertOrRestore', () => {

    it('should insert connections that dont exist and restore the others', (done) => {
      var connection1 = new helpers.DummyConnection([ () => {}, '9abc' ])
        , connection2 = new helpers.DummyConnection([ () => {}, 'fghj' ])
        , restoredConnection
      connection1.testData = { a: 1, b: 2 }
      connection2.testData = { c: 3, d: 4 }

      async.series([
        // Check that connections indeed dont exist
        connectionExists.bind(this, connection1),
        connectionExists.bind(this, connection2),

        // Insert connections
        store.connectionInsertOrRestore.bind(store, connection1),
        store.connectionInsertOrRestore.bind(store, connection2),
        
        // Check that now they do exist
        connectionExists.bind(this, connection1),
        connectionExists.bind(this, connection2),

        // Restore a connection
        (next) => {
          restoredConnection = new helpers.DummyConnection([ () => {}, '9abc' ])
          assert.equal(connection1.restoredTestData, null)
          assert.equal(connection2.restoredTestData, null)
          store.connectionInsertOrRestore(restoredConnection, next)
        }

      ], (err, results) => {
        if (err) throw err
        var existed1Before = results.shift()
          , existed2Before = results.shift()
        results.shift()
        results.shift()
        var existed1After = results.shift()
          , existed2After = results.shift()

        assert.equal(existed1Before, false)
        assert.equal(existed2Before, false)
        assert.equal(existed1After, true)
        assert.equal(existed2After, true)
        assert.deepEqual(restoredConnection.restoredTestData, { a: 1, b: 2 })
        done()
      })

    })

    it('should insert connections and automatically assign id if null and autoId is true', (done) => {
      var connection = new helpers.DummyConnection([ () => {}, null ])
      connection.testData = { a: 1, b: 2 }
      connection.autoId = true
      assert.equal(connection.id, null)
      store.connectionInsertOrRestore(connection, (err, results) => {
        if (err) throw err
        assert.ok(connection.id !== null)
        assert.ok(connection.id.length > 4)
        done()
      })
    })

    it('should return an error when inserting, if id is null and autoId is false', (done) => {
      var connection = new helpers.DummyConnection([ () => {}, null ])
      connection.testData = { a: 1, b: 2 }
      connection.autoId = false
      assert.equal(connection.id, null)
      store.connectionInsertOrRestore(connection, (err, results) => {
        assert.ok(err)
        done()
      })
    })

    it('should assign a new id when autoId is true and connection could not be restored', (done) => {
      var id = 'Idontexist'
        , connection = new helpers.DummyConnection([ () => {}, 'Idontexist' ])
      connection.autoId = true
      store.connectionInsertOrRestore(connection, (err, results) => {
        if (err) throw err
        assert.ok(connection.id !== null)
        assert.ok(connection.id.length > 4)
        assert.ok(connection.id != id)
        done()
      })
    })

  })

  describe('connectionUpdate', () => {

    it('should update connections that exist', (done) => {
      var connection = new helpers.DummyConnection([ () => {}, '9abc' ])
        , restoredConnection = new helpers.DummyConnection([ () => {}, connection.id ])
      connection.testData = { a: 1, b: 2 }

      async.series([
        store.connectionInsertOrRestore.bind(store, connection),
        (next) => {
          connection.testData = { c: 8, d: 99 }
          store.connectionUpdate(connection, next)
        },
        store.connectionInsertOrRestore.bind(store, restoredConnection)
      ], (err, results) => {
        if (err) throw err
        assert.deepEqual(restoredConnection.restoredTestData, { c: 8, d: 99 })
        done()
      })

    })

  })

  describe('connectionIdList', () => {

    it('should list connection ids', (done) => {
      var connection1 = new helpers.DummyConnection([ () => {}, 'defg' ])
        , connection2 = new helpers.DummyConnection([ () => {}, 'hijk' ])
        , connection3 = new helpers.DummyConnection([ () => {}, 'lmno' ])
        , connection4 = new helpers.DummyConnection([ () => {}, 'pqrs' ])

      async.series([
        store.connectionInsertOrRestore.bind(store, connection1),
        store.connectionInsertOrRestore.bind(store, connection2),
        store.connectionInsertOrRestore.bind(store, connection3),
        store.connectionIdList.bind(store, 'dummy')
      ], (err, results) => {
        if (err) throw err
        var idList = results.pop()
        idList.sort()
        assert.deepEqual(idList, ['defg', 'hijk', 'lmno'])
        done()
      })
    })

  })

  describe('managerSave/managerRestore', () => {

    it('should save/restore manager state', (done) => {
      var state = {
        nsTree: [{a: 5678, b: 122121}, {c: 888, b: 122121}],
        idCounters: {blabla: 1234}
      }
      async.series([
        store.managerSave.bind(store, state),
        store.managerRestore.bind(store)
      ], (err, results) => {
        if (err) throw err
        var restored = results.pop()
        assert.deepEqual(restored, state)
        done()
      })
    })

    it('should return null if no state saved', (done) => {
      store.managerRestore((err, state) => {
        if (err) throw err
        assert.equal(state, null)
        done()
      })
    })

    it('should handle buffers', (done) => {
      var state = {nsTree: [
        {address: '/', lastMessage: [122121]},
        {address: '/bla', lastMessage: ['hello', new Buffer('blabla'), 1234]}
      ]}
      async.series([
        store.managerSave.bind(store, state),
        store.managerRestore.bind(store)
      ], (err, results) => {
        if (err) throw err
        var restored = results.pop()
        assert.deepEqual(restored, {nsTree: [
          {address: '/', lastMessage: [122121]},
          {address: '/bla', lastMessage: ['hello', new Buffer(''), 1234]}
        ]})
        done()
      })
    })

  })
}

describe('connections.persistence.NEDBStore', () => {

  var store = new persistence.NEDBStore(helpers.testDbDir)

  var connectionExists = (connection, done) => {
    var query = { connectionId: connection.id, namespace: connection.namespace }
    store._connectionsCollection.findOne(query, (err, doc) => {
      done(err, !!doc)
    })
  }

  beforeEach((done) => helpers.beforeEach([ store ], done))
  afterEach((done) => helpers.afterEach([ store ], done))
  
  testSuite(store, connectionExists)

  it('shouldnt crash if manager state is missing fields or invalid', (done) => {
    
    async.series([
      fs.writeFile.bind(fs, store._managerFile, JSON.stringify({})),
      store.managerRestore.bind(store)
    ], done)
  })

})


describe('connections.persistence.RedisStore', () => {

  var store = new persistence.RedisStore()
  // Mock-up with fakeredis
  store._createClient = function() { return fakeredis.createClient() }
  store.stop = function(done) { 
    this._redisClient = null
    done()
  }

  var connectionExists = (connection, done) => {
    store._redisClient.get(store._makeKey(connection), (err, value) => {
      done(err, !!value)
    })
  }

  beforeEach((done) => {
    async.series([
      (next) => helpers.beforeEach([ store ], next),
      (next) => store._redisClient.flushdb(next)
    ], done)
  })
  afterEach((done) => helpers.afterEach([ store ], done))
  
  testSuite(store, connectionExists)
})