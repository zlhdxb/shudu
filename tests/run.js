#!/usr/bin/env node
/**
 * 网页版界面自测：用 jsdom 加载 docs/index.html（跑页面真实脚本），
 * 再把 tests/browser-test.js 注入进去做黑盒断言 —— 只看 DOM，不读内部状态。
 *
 * 用法：
 *   npm install jsdom
 *   node tests/run.js
 *
 * 每跑一次都会现场随机生成新题目，所以多跑几轮更有意义。
 * 退出码：0 全过，1 有断言失败，2 缺依赖。
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (err) {
  console.error('缺少依赖 jsdom，请先在仓库根目录运行：');
  console.error('  npm install jsdom');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'docs', 'index.html');
const HARNESS = path.join(__dirname, 'browser-test.js');

const html = fs.readFileSync(INDEX, 'utf8').replace(
  '</body>',
  '<script>\n' + fs.readFileSync(HARNESS, 'utf8') + '\n</script>\n</body>'
);

const pageErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => pageErrors.push('页面异常: ' + (e.stack || e.message)));
vc.on('error', (...a) => pageErrors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  url: pathToFileURL(INDEX).href, // 让 style.css / sudoku-core.js / app.js 的相对路径能解析
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
});

const TIMEOUT = Number(process.env.TIMEOUT_MS || 20000);
const timer = setTimeout(() => {
  console.error('超时：' + TIMEOUT + 'ms 内没跑完');
  if (pageErrors.length) console.error(pageErrors.join('\n'));
  process.exit(1);
}, TIMEOUT);

dom.window.addEventListener('load', () => {
  setTimeout(() => {
    clearTimeout(timer);
    const pre = dom.window.document.getElementById('testout');
    if (!pre) {
      console.error('没拿到测试输出 —— 页面脚本可能没跑起来');
      console.error('棋盘格数: ' + dom.window.document.querySelectorAll('#board .cell').length);
      if (pageErrors.length) console.error('\n' + pageErrors.join('\n'));
      process.exit(1);
    }
    console.log(pre.textContent);
    if (pageErrors.length) console.log('\n页面报错：\n' + pageErrors.join('\n'));
    process.exit(/FAIL:/.test(pre.textContent) ? 1 : 0);
  }, 400);
});
