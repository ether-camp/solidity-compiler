var fs = require('fs');
var execFile = require('child_process').execFile;
var _ = require('lodash');
var solc = require('solc');

function Compiler(dir, solcBin) {
  this.dir = dir || '.';
  this.solcBin = solcBin;
}

Compiler.prototype.compile = function(file, cb) {
  if (this.solcBin) this.compileWithBin(file, cb);
  else this.compileWithJs(file, cb);
};

Compiler.prototype.compileWithJs = function(file, cb) {
  var dir = this.dir;
  fs.readFile(this.dir + '/' + file, function(err, data) {
    if (err) return cb(err);

    var input = {};
    input[file] = data.toString();
    var output = solc.compile({ sources: input }, 1, function findImports(path) {
      try {
        return { contents: fs.readFileSync(dir + '/' + path).toString() };
      } catch (e) {
        return { error: e };
      }
    });

    if (output.errors) return cb(output.errors);

    try {
      cb(
        null,
        findNotAbstractContracts(output.sources)
          .map(function(name) {
            return {
              name: name,
              binary: output.contracts[name].bytecode,
              abi: JSON.parse(output.contracts[name].interface)
            };
          })
      );
    } catch (e) {
      return cb('Could not parse contract abi: ' + e.message);
    }
  });
};

Compiler.prototype.compileWithBin = function(file, cb) {
  this.solc(
    [file, '--optimize', '--combined-json', 'bin,abi,ast'],
    function(err, stdout, stderr) {
      if (err) return cb(err);
      if (stderr) return cb(stderr);

      try {
        var compiled = JSON.parse(stdout);
      } catch (e) {
        return cb('Could not parse solc output: ' + e.message);
      }
      
      try {
        cb(
          null,
          findNotAbstractContracts(compiled.sources)
            .map(function(name) {
              return {
                name: name,
                binary: compiled.contracts[name].bin,
                abi: JSON.parse(compiled.contracts[name].abi)
              };
            })
        );
      } catch (e) {
        return cb('Could not parse contract abi: ' + e.message);
      }
    }
  );
};

function findNotAbstractContracts(sources) {
  return _(sources).map(function(source) {
    return _(extractContracts(source.AST))
      .filter({ abstract: false })
      .map('name')
      .value();
  }).flatten().value();
  
  function extractContracts(node) {
    var contracts = _(node.children)
          .map(extractContracts)
          .flatten()
          .value();
    if (node.name === 'Contract') {
      contracts.push({
        name: node.attributes.name,
        abstract: isAbstract(node)
      });
    }
    return contracts;
  }
  
  function isAbstract(node) {
    return node.attributes.name === 'abstract' ||
      // solc <= 0.2.0
      _.filter(node.children, {
        name: 'Identifier',
        attributes: { value: 'abstract' }
      }).length != 0 ||
      // solc > 0.2.0
      _.filter(node.children, {
        name: 'UserDefinedTypeName',
        attributes: { name: 'abstract' }
      }).length != 0;
  }
}

Compiler.prototype.solc = function(args, cb) {
  execFile(
    this.solcBin,
    args,
    {
       cwd: this.dir,
       maxBuffer: 1024 * 1024
    },
    cb
  );
};

module.exports = Compiler;
