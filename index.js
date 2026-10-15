const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const axios = require('axios');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const express = require('express');
const app = express();
// 环境变量优先；平台不支持环境变量时，直接填写下面的默认值后再混淆。
const UUID = process.env.UUID || ''; // 填 dashboard 中对应服务器的 ID，同时作为代理 UUID
const PROBE_URL = process.env.PROBE_URL || 'https://tz.765431.xyz/update';
const PROBE_SECRET = process.env.PROBE_SECRET || ''; // 留空不启动探针
const PROBE_INTERVAL = Number(process.env.PROBE_INTERVAL || 60);
const PROBE_CT = process.env.PROBE_CT ?? 'gd-ct-dualstack.ip.zstaticcdn.com';
const PROBE_CU = process.env.PROBE_CU ?? 'gd-cu-dualstack.ip.zstaticcdn.com';
const PROBE_CM = process.env.PROBE_CM ?? 'gd-cm-dualstack.ip.zstaticcdn.com';
const FILE_PATH = process.env.FILE_PATH || '.tmp';
const SUB_PATH = (process.env.SUB_PATH || 'sub').replace(/^\/+|\/+$/g, '');
const NAME = process.env.NAME || 'Node';
const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 3000);
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const ARGO_PORT = Number(process.env.ARGO_PORT || 8001);
const CFIP = process.env.CFIP || ARGO_DOMAIN;
const CFPORT = Number(process.env.CFPORT || 443);

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(UUID)) {
  throw new Error('请在源码开头或环境变量中填写有效 UUID（dashboard 的服务器 ID）');
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT 无效');
if (!Number.isInteger(PROBE_INTERVAL) || PROBE_INTERVAL < 1) throw new Error('PROBE_INTERVAL 无效');
const workDir = path.resolve(FILE_PATH);
fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
const runtimeFiles = new Set();
const children = new Set();
let stopping = false;
const PROBE_RELEASE = 'v1.0.19';
const PROBE_HASHES = {
  amd64: '64cc6e2a34ac49a39fb04894a48262bc0b3221d97ba7314dde15ad108097d52c',
  arm64: '976f6ca9a884823f0467876f5d5a458b5ffe47dd3ef78f9f141da4a529913503'
};

function binaryArchitecture() {
  const arch = { x64: 'amd64', arm64: 'arm64' }[os.arch()];
  if (process.platform !== 'linux' || !arch) throw new Error('外部二进制仅支持 Linux amd64/arm64');
  return arch;
}

async function prepareBinary(name, url, expectedHash, localFile) {
  const destination = path.join(workDir, crypto.randomBytes(6).toString('hex'));
  runtimeFiles.add(destination);
  try {
    if (fs.existsSync(localFile)) {
      await fs.promises.copyFile(localFile, destination);
    } else {
      const response = await axios.get(url, { responseType: 'stream', timeout: 60000 });
      await pipeline(response.data, fs.createWriteStream(destination, { mode: 0o700 }));
    }
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(destination)) hash.update(chunk);
    if (hash.digest('hex') !== expectedHash) throw new Error(name + ' SHA-256 校验失败');
    await fs.promises.chmod(destination, 0o700);
    return destination;
  } catch (error) {
    await fs.promises.unlink(destination).catch(() => {});
    throw error;
  }
}

function runBinary(file, args, name) {
  return new Promise((resolve, reject) => {
    if (stopping) return reject(new Error('服务正在停止'));
    const child = spawn(file, args, { stdio: 'ignore', windowsHide: true });
    children.add(child);
    child.once('spawn', () => resolve(child));
    child.once('error', () => { children.delete(child); reject(new Error(name + ' 启动失败')); });
    child.once('exit', (code, signal) => {
      children.delete(child);
      if (!stopping) console.error(name + ' 已退出 (' + (signal || code) + ')');
    });
  });
}

async function startProbe(localName) {
  if (!PROBE_SECRET) return;
  const arch = binaryArchitecture();
  if (new URL(PROBE_URL).protocol !== 'https:') throw new Error('PROBE_URL 必须使用 HTTPS');
  const values = {
    SERVER_ID: UUID, SECRET: PROBE_SECRET, WORKER_URL: PROBE_URL,
    COLLECT_INTERVAL: 0, REPORT_INTERVAL: PROBE_INTERVAL,
    CT_NODE: PROBE_CT, CU_NODE: PROBE_CU, CM_NODE: PROBE_CM,
    BD_NODE: '', NODE_1: '', NODE_2: '', NODE_3: '', NODE_4: '', INTERFACE: '',
    RESET_DAY: 1, CONNECTION_MODE: 'auto', PING_MODE: 'tcp',
    AUTO_UPDATE: 0, UPDATE_PROXY: '', CONFIG_MD5: 'none'
  };
  for (const value of Object.values(values)) {
    if (/[\r\n"]/.test(String(value))) throw new Error('探针参数不能包含换行或双引号');
  }
  const config = path.join(workDir, 'probe.conf');
  const binary = await prepareBinary('探针',
    'https://github.com/huilang-me/cfsm-agent/releases/download/' + PROBE_RELEASE + '/cf-probe-linux-' + arch,
    PROBE_HASHES[arch], path.join(__dirname, arch, localName));
  await fs.promises.writeFile(config,
    Object.entries(values).map(([key, value]) => key + '=' + JSON.stringify(String(value))).join('\n') + '\n',
    { mode: 0o600 });
  runtimeFiles.add(config);
  await runBinary(binary, ['run', '-config', config], '探针');
}

function scheduleCleanup() {
  // 只删除本次启动文件，不删工作目录；探针可以继续写入自己的状态。
  setTimeout(async () => {
    for (const file of runtimeFiles) {
      await fs.promises.unlink(file).catch(error => {
        if (error.code !== 'ENOENT') console.error('运行文件清理失败: ' + path.basename(file));
      });
    }
    console.log('启动文件已清理');
  }, 90000).unref();
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    stopping = true;
    for (const child of children) child.kill('SIGTERM');
    process.exit(0);
  });
}

const configPath = path.join(workDir, 'config.json');
const XRAY_HASHES = {
  amd64: '3f650abf1fc4a4fbf5abe7fc9990a2658020907cd984214e9c075b4b00989fea',
  arm64: '0f4b7cbaab8964beebffa0c226185326a35af560ecfed9da0b2ad9bc2ff9ded3'
};
const TUNNEL_HASHES = {
  amd64: '176746db3be7dc7bd48f3dd287c8930a4645ebb6e6700f883fddda5a4c307c16',
  arm64: '03c5d58e283f521d752dc4436014eb341092edf076eb1095953ab82debe54a8e'
};

async function generateConfig() {
    const config = {
        log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
        inbounds: [
            { port: ARGO_PORT, protocol: 'vless', settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: [{ dest: 3001 }, { path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }, { path: "/trojan-argo", dest: 3004 }] }, streamSettings: { network: 'tcp' } },
            { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
            { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
            { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
            { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
        ],
        dns: { servers: ["https+local://8.8.8.8/dns-query"] },
        outbounds: [{ protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "block" }]
    };
    fs.writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
    runtimeFiles.add(configPath);
}


function tunnelArguments() {
  const args = ['tunnel', '--edge-ip-version', 'auto', '--no-autoupdate', '--protocol', 'http2'];
  if (!ARGO_AUTH.trim().startsWith('{')) return [...args, 'run', '--token', ARGO_AUTH];
  const credentials = JSON.parse(ARGO_AUTH);
  if (!credentials.TunnelID || !credentials.TunnelSecret || !credentials.AccountTag) {
    throw new Error('ARGO_AUTH 的 JSON 凭据不完整');
  }
  const credentialsPath = path.join(workDir, 'tunnel.json');
  const tunnelConfig = path.join(workDir, 'tunnel.yml');
  fs.writeFileSync(credentialsPath, JSON.stringify(credentials), { mode: 0o600 });
  // JSON 是合法 YAML，避免域名或路径的引号破坏配置。
  fs.writeFileSync(tunnelConfig, JSON.stringify({
    tunnel: credentials.TunnelID, 'credentials-file': credentialsPath,
    ingress: [{ hostname: ARGO_DOMAIN, service: 'http://127.0.0.1:' + ARGO_PORT }, { service: 'http_status:404' }]
  }), { mode: 0o600 });
  runtimeFiles.add(credentialsPath);
  runtimeFiles.add(tunnelConfig);
  return [...args, '--config', tunnelConfig, 'run'];
}

let subscription = '';
app.get('/' + SUB_PATH, (req, res) => {
  if (!subscription) return res.status(503).type('text/plain').send('Starting');
  res.type('text/plain').send(subscription);
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

function generateLinks() {
  const nodeName = encodeURIComponent(NAME);
  const vmess = { v: '2', ps: NAME, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'auto',
    net: 'ws', type: 'none', host: ARGO_DOMAIN, path: '/vmess-argo?ed=2560', tls: 'tls', sni: ARGO_DOMAIN, fp: 'firefox' };
  const query = protocol => new URLSearchParams({ ...(protocol === 'vless' ? { encryption: 'none' } : {}),
    security: 'tls', sni: ARGO_DOMAIN, fp: 'firefox', type: 'ws', host: ARGO_DOMAIN, path: '/' + protocol + '-argo?ed=2560' });
  const address = CFIP.includes(':') ? '[' + CFIP + ']' : CFIP;
  subscription = Buffer.from([
    'vless://' + UUID + '@' + address + ':' + CFPORT + '?' + query('vless') + '#' + nodeName,
    'vmess://' + Buffer.from(JSON.stringify(vmess)).toString('base64'),
    'trojan://' + UUID + '@' + address + ':' + CFPORT + '?' + query('trojan') + '#' + nodeName
  ].join('\n')).toString('base64');
}

async function startServer() {
  if (!ARGO_AUTH || !ARGO_DOMAIN || !CFIP) throw new Error('请填写 ARGO_AUTH、ARGO_DOMAIN 和节点入口 CFIP');
  if (![ARGO_PORT, CFPORT].every(port => Number.isInteger(port) && port > 0 && port <= 65535)) throw new Error('隧道端口无效');
  const arch = binaryArchitecture();
  const args = tunnelArguments();
  await generateConfig();
  const baseURL = 'https://raw.githubusercontent.com/sz30/appa/main/' + arch + '/';
  const [web, bot] = await Promise.all([
    prepareBinary('Xray', baseURL + 'web', XRAY_HASHES[arch], path.join(__dirname, arch, 'web')),
    prepareBinary('cloudflared', baseURL + 'bot', TUNNEL_HASHES[arch], path.join(__dirname, arch, 'bot'))
  ]);
  await runBinary(web, ['-c', configPath], 'Xray');
  await runBinary(bot, args, 'cloudflared');
  await startProbe('v1').catch(() => console.error('探针启动失败，请检查参数及网络'));
  generateLinks();
}

app.listen(PORT, () => {
  console.log('HTTP server listening on ' + PORT);
  startServer().catch(() => console.error('代理启动失败，请检查隧道参数及二进制下载')).finally(scheduleCleanup);
});
