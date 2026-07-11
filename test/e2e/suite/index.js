const path = require("path");
const Mocha = require("mocha");

exports.run = function run() {
  const mocha = new Mocha({ ui: "bdd", timeout: 60000, color: true });
  mocha.addFile(path.resolve(__dirname, "smoke.test.js"));
  return new Promise((resolve, reject) => {
    mocha.run((failures) =>
      failures ? reject(new Error(`${failures} e2e test(s) failed`)) : resolve()
    );
  });
};
