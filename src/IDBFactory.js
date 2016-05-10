(function(idbModules) {
    'use strict';

    var DEFAULT_DB_SIZE = 4 * 1024 * 1024;
    var sysdb;

    /**
     * Craetes the sysDB to keep track of version numbers for databases
     **/
    function createSysDB(success, failure) {
        function sysDbCreateError(tx, err) {
            err = idbModules.util.findError(arguments);
            idbModules.DEBUG && console.log("Error in sysdb transaction - when creating dbVersions", err);
            failure(err);
        }

        if (sysdb) {
            success();
        }
        else {
            sysdb = window.openDatabase("__sysdb__", 1, "System Database", DEFAULT_DB_SIZE);
            sysdb.transaction(function(tx) {
                tx.executeSql("CREATE TABLE IF NOT EXISTS dbVersions (name VARCHAR(255), version INT);", [], success, sysDbCreateError);
            }, sysDbCreateError);
        }
    }

    /**
     * IDBFactory Class
     * https://w3c.github.io/IndexedDB/#idl-def-IDBFactory
     * @constructor
     */
    function IDBFactory() {
        this.modules = idbModules;
    }

    /**
     * The IndexedDB Method to create a new database and return the DB
     * @param {string} name
     * @param {number} version
     */
    IDBFactory.prototype.open = function(name, version) {
        console.log('open with version: ' + version);

        var req = new idbModules.IDBOpenDBRequest();
        var calledDbCreateError = false;

        if (arguments.length === 0) {
            throw new TypeError('Database name is required');
        }
        else if (arguments.length === 2) {
            version = parseFloat(version);
            if (isNaN(version) || !isFinite(version) || version <= 0) {
                throw new TypeError('Invalid database version: ' + version);
            }
        }
        name = name + ''; // cast to a string

        function dbCreateError(tx, err) {
            if (calledDbCreateError) {
                return;
            }
            err = idbModules.util.findError(arguments);
            calledDbCreateError = true;
            var evt = idbModules.util.createEvent("error", arguments);
            req.readyState = "done";
            req.error = err || "DOMError";
            idbModules.util.callback("onerror", req, evt);
        }

        function openDB(oldVersion) {
            console.log('openDB oldVersion: ' + oldVersion);
            //var db = window.openDatabase(name, 1, name, DEFAULT_DB_SIZE);

            //* **
            var isLocked = false;
            var tq = [];
            var tqnext = function() {
              if (tq.length !== 0) {
                console.log('start next');
                isLocked = true;
                tq.shift().start();
              }
            };

            var x = new XMLHttpRequest();
            x.open('POST', 'http://localhost:8000/', true);
            x.onreadystatechange = function(ev) {
              if (x.readyState === 4) {
                if (x.status === 200) {
                  console.log('open ok with response text: ' + x.responseText);
                  tqnext();
                }
              }
            };
            x.onerror = function(e) {
              console.log('open HTTP error: ' + JSON.stringify(e));
            };
            x.send(JSON.stringify({"op":"open","dbname":name}));

            isLocked = true;

            var db = {
              transaction: function(f, ecb, okcb) {
                console.log('starting transaction');
                tq.push({
                  start: function() {
                    var eq = [];
                    var l = false;
                    var ln = function() {
                      if (!l) {
                        l = true;
                        eq.shift().e();
                      }
                    };

                    var tx = {
                      executeSql: function(s, v, cb1, cb2) {
                        console.log('execute sql: ' + s + ' v: ' + JSON.stringify(v));

                        eq.push({
                          e: function() {
                            var x = new XMLHttpRequest();
                            x.open('POST', 'http://localhost:8000/', true);
                            x.onreadystatechange = function(ev) {
                              if (x.readyState === 4) {
                                if (x.status === 200) {
                                  console.log('sql ok with response text: ' + x.responseText);
                                  var r = JSON.parse(x.responseText);
                                  if (!!cb1) {
                                    //cb1(tx, {rows:[]});
                                    cb1(tx, {
                                      rows: {
                                        length: r.rows.length,
                                        item: function(i) {
                                          return r.rows[i];
                                        }
                                      }
                                    });
                                  }
                                  l = false;
                                  if (eq.length !== 0) {
                                    ln();
                                  } else {
                                    isLocked = false;
                                    if (!!okcb) {
                                      okcb();
                                    }
                                    tqnext();
                                  }
                                }
                              }
                            };
                            x.onerror = function(e) {
                              console.log('execute HTTP error: ' + JSON.stringify(e));
                            };
                            x.send(JSON.stringify({"op":"exec","dbname":name,"sql":s,"params":v}));
                          }
                        });
                        ln();
                      }
                    };
                    f(tx);
                  }
                });
                tqnext();
              }
            };
            // ** */

            req.readyState = "done";
            if (typeof version === "undefined") {
                version = oldVersion || 1;
            }
            if (version <= 0 || oldVersion > version) {
                var err = idbModules.util.createDOMError("VersionError", "An attempt was made to open a database using a lower version than the existing version.", version);
                dbCreateError(err);
                return;
            }

            db.transaction(function(tx) {
                tx.executeSql("CREATE TABLE IF NOT EXISTS __sys__ (name VARCHAR(255), keyPath VARCHAR(255), autoInc BOOLEAN, indexList BLOB)", [], function() {
                    tx.executeSql("SELECT * FROM __sys__", [], function(tx, data) {
                        console.log('cb1');
                        var e = idbModules.util.createEvent("success");
                        req.source = req.result = new idbModules.IDBDatabase(db, name, version, data);
                        //console.log('cb2');
                        console.log('oldVersion: ' + oldVersion + 'version: ' + version);
                        if (oldVersion < version) {
                            // DB Upgrade in progress
                            sysdb.transaction(function(systx) {
                                systx.executeSql("UPDATE dbVersions set version = ? where name = ?", [version, name], function() {
                                    var e = idbModules.util.createEvent("upgradeneeded");
                                    e.oldVersion = oldVersion;
                                    e.newVersion = version;
                                    req.transaction = req.result.__versionTransaction = new idbModules.IDBTransaction(req.source, [], idbModules.IDBTransaction.VERSION_CHANGE);
                                    req.transaction.__addToTransactionQueue(function onupgradeneeded(tx, args, success) {
                                        idbModules.util.callback("onupgradeneeded", req, e);
                                        success();
                                    });
                                    req.transaction.__oncomplete = function() {
                                        console.log('s1');
                                        req.transaction = null;
                                        var e = idbModules.util.createEvent("success");
                                        idbModules.util.callback("onsuccess", req, e);
                                    };
                                }, dbCreateError);
                            }, dbCreateError);
                        } else {
                            console.log('s2');
                            idbModules.util.callback("onsuccess", req, e);
                        }
                    }, dbCreateError);
                }, dbCreateError);
            }, dbCreateError);
        }

        createSysDB(function() {
            sysdb.transaction(function(tx) {
                tx.executeSql("SELECT * FROM dbVersions where name = ?", [name], function(tx, data) {
                    if (data.rows.length === 0) {
                        // Database with this name does not exist
                        tx.executeSql("INSERT INTO dbVersions VALUES (?,?)", [name, version || 1], function() {
                            openDB(0);
                        }, dbCreateError);
                    } else {
                        openDB(data.rows.item(0).version);
                    }
                }, dbCreateError);
            }, dbCreateError);
        }, dbCreateError);

        return req;
    };

    /**
     * Deletes a database
     * @param {string} name
     * @returns {IDBOpenDBRequest}
     */
    IDBFactory.prototype.deleteDatabase = function(name) {
        var req = new idbModules.IDBOpenDBRequest();
        var calledDBError = false;
        var version = null;

        if (arguments.length === 0) {
            throw new TypeError('Database name is required');
        }
        name = name + ''; // cast to a string

        function dbError(tx, err) {
            if (calledDBError) {
                return;
            }
            err = idbModules.util.findError(arguments);
            req.readyState = "done";
            req.error = err || "DOMError";
            var e = idbModules.util.createEvent("error");
            e.debug = arguments;
            idbModules.util.callback("onerror", req, e);
            calledDBError = true;
        }

        function deleteFromDbVersions() {
            sysdb.transaction(function(systx) {
                systx.executeSql("DELETE FROM dbVersions where name = ? ", [name], function() {
                    req.result = undefined;
                    var e = idbModules.util.createEvent("success");
                    e.newVersion = null;
                    e.oldVersion = version;
                    idbModules.util.callback("onsuccess", req, e);
                }, dbError);
            }, dbError);
        }

        createSysDB(function() {
            sysdb.transaction(function(systx) {
                systx.executeSql("SELECT * FROM dbVersions where name = ?", [name], function(tx, data) {
                    if (data.rows.length === 0) {
                        req.result = undefined;
                        var e = idbModules.util.createEvent("success");
                        e.newVersion = null;
                        e.oldVersion = version;
                        idbModules.util.callback("onsuccess", req, e);
                        return;
                    }
                    version = data.rows.item(0).version;
                    var db = window.openDatabase(name, 1, name, DEFAULT_DB_SIZE);
                    db.transaction(function(tx) {
                        tx.executeSql("SELECT * FROM __sys__", [], function(tx, data) {
                            var tables = data.rows;
                            (function deleteTables(i) {
                                if (i >= tables.length) {
                                    // If all tables are deleted, delete the housekeeping tables
                                    tx.executeSql("DROP TABLE IF EXISTS __sys__", [], function() {
                                        // Finally, delete the record for this DB from sysdb
                                        deleteFromDbVersions();
                                    }, dbError);
                                } else {
                                    // Delete all tables in this database, maintained in the sys table
                                    tx.executeSql("DROP TABLE " + idbModules.util.quote(tables.item(i).name), [], function() {
                                        deleteTables(i + 1);
                                    }, function() {
                                        deleteTables(i + 1);
                                    });
                                }
                            }(0));
                        }, function(e) {
                            // __sysdb table does not exist, but that does not mean delete did not happen
                            deleteFromDbVersions();
                        });
                    });
                }, dbError);
            }, dbError);
        }, dbError);

        return req;
    };

    /**
     * Compares two keys
     * @param key1
     * @param key2
     * @returns {number}
     */
    IDBFactory.prototype.cmp = function(key1, key2) {
        if (arguments.length < 2) {
            throw new TypeError("You must provide two keys to be compared");
        }

        idbModules.Key.validate(key1);
        idbModules.Key.validate(key2);
        var encodedKey1 = idbModules.Key.encode(key1);
        var encodedKey2 = idbModules.Key.encode(key2);
        var result = encodedKey1 > encodedKey2 ? 1 : encodedKey1 === encodedKey2 ? 0 : -1;
        
        if (idbModules.DEBUG) {
            // verify that the keys encoded correctly
            var decodedKey1 = idbModules.Key.decode(encodedKey1);
            var decodedKey2 = idbModules.Key.decode(encodedKey2);
            if (typeof key1 === "object") {
                key1 = JSON.stringify(key1);
                decodedKey1 = JSON.stringify(decodedKey1);
            }
            if (typeof key2 === "object") {
                key2 = JSON.stringify(key2);
                decodedKey2 = JSON.stringify(decodedKey2);
            }

            // encoding/decoding mismatches are usually due to a loss of floating-point precision
            if (decodedKey1 !== key1) {
                console.warn(key1 + ' was incorrectly encoded as ' + decodedKey1);
            }
            if (decodedKey2 !== key2) {
                console.warn(key2 + ' was incorrectly encoded as ' + decodedKey2);
            }
        }
        
        return result;
    };


    idbModules.shimIndexedDB = new IDBFactory();
    idbModules.IDBFactory = IDBFactory;
}(idbModules));
