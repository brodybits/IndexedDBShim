var http = require('http');

var sqlite3 = require('sqlite3');

var dbmap = {};

http.createServer(function(req, res) {
  //res.end('asdf');
  // THANKS for guidance: http://stackoverflow.com/a/4310087/1283667
  var mybody = '';
  req.on('data', function(d) { mybody += d;});
  //req.on('end', function() { res.end('body data: ' + mybody + '\n');});
  req.on('end', function() {
    var o = JSON.parse(mybody);
    var op = o.op;
    var dbname = o.dbname;
    console.log('op: ' + op + ' dbname: ' + dbname);
    //res.end('got JSON: ' + JSON.stringify(o));
    if (op === 'open') {
      dbmap[dbname] = new sqlite3.Database(dbname);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end('{"success":true}');
    } else if (op === 'exec') {
      var sql = o.sql;
      var params = o.params;
      console.log('sql: ' + sql + ' params: ' + params);
      dbmap[dbname].all(sql, params, function(e, r) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (e) res.end('{"success":false, "error":' + JSON.stringify(e) + '}');
        else res.end('{"success":true,"rows":' + JSON.stringify(r) + '}');
      });
    } else {
      res.end('{"success":false, "error":"invalid"}');
    }
  });
}).listen(8000);
