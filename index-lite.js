const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const FILE_PATH = process.env.FILE_PATH || '.tmp';
const SUB_PATH = process.env.SUB_PATH || '';
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const UUID = process.env.UUID || '';
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const ARGO_PORT = process.env.ARGO_PORT || 8001;
const CFIP = process.env.CFIP || 'cf.090227.xyz';
const CFPORT = process.env.CFPORT || 443;
const NAME = process.env.NAME || '';

if (!fs.existsSync(FILE_PATH)) {
    fs.mkdirSync(FILE_PATH);
    console.log(`${FILE_PATH} is created`);
} else {
    console.log(`${FILE_PATH} already exists`);
}

function generateRandomName() {
    const characters = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

const webName = generateRandomName();
const botName = generateRandomName();
const phpName = generateRandomName();
let phpPath = path.join(FILE_PATH, phpName);
let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let subPath = path.join(FILE_PATH, 'sub.txt');
let listPath = path.join(FILE_PATH, 'list.txt');
let configPath = path.join(FILE_PATH, 'config.json');

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
    fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
}

function getSystemArchitecture() {
    const arch = os.arch();
    if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') {
        return 'arm';
    } else {
        return 'amd';
    }
}

function downloadFile(fileName, fileUrl, callback) {
    const filePath = fileName;

    if (!fs.existsSync(FILE_PATH)) {
        fs.mkdirSync(FILE_PATH, { recursive: true });
    }

    const writer = fs.createWriteStream(filePath);

    axios({
        method: 'get',
        url: fileUrl,
        responseType: 'stream',
    })
        .then(response => {
            response.data.pipe(writer);

            writer.on('finish', () => {
                writer.close();
                console.log(`Download ${path.basename(filePath)} successfully`);
                callback(null, filePath);
            });

            writer.on('error', err => {
                fs.unlink(filePath, () => { });
                const errorMessage = `Download ${path.basename(filePath)} failed: ${err.message}`;
                console.error(errorMessage);
                callback(errorMessage);
            });
        })
        .catch(err => {
            const errorMessage = `Download ${path.basename(filePath)} failed: ${err.message}`;
            console.error(errorMessage);
            callback(errorMessage);
        });
}

async function downloadFilesAndRun() {
    const architecture = getSystemArchitecture();
    const filesToDownload = getFilesForArchitecture(architecture);
    if (filesToDownload.length === 0) {
        console.log(`Can't find a file for the current architecture`);
        return;
    }
    const downloadPromises = filesToDownload.map(fileInfo => {
        return new Promise((resolve, reject) => {
            if (fs.existsSync(fileInfo.fileName)) {
                console.log(`${path.basename(fileInfo.fileName)} already exists, skipping download`);
                resolve(fileInfo.fileName);
            } else {
                downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err, filePath) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(filePath);
                    }
                });
            }
        });
    });

    try {
        await Promise.all(downloadPromises);
    } catch (err) {
        console.error('Error downloading files:', err);
        return;
    }
    function authorizeFiles(filePaths) {
        const newPermissions = 0o775;
        filePaths.forEach(absoluteFilePath => {
            if (fs.existsSync(absoluteFilePath)) {
                fs.chmod(absoluteFilePath, newPermissions, (err) => {
                    if (err) {
                        console.error(`Empowerment failed for ${absoluteFilePath}: ${err}`);
                    } else {
                        console.log(`Empowerment success for ${absoluteFilePath}: ${newPermissions.toString(8)}`);
                    }
                });
            }
        });
    }
    const filesToAuthorize = [phpPath, webPath, botPath];
    authorizeFiles(filesToAuthorize);

    if (NEZHA_SERVER && NEZHA_KEY) {
        const port = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
        const tlsPorts = new Set(['443', '8443', '2096', '2087', '2083', '2053']);
        const nezhatls = tlsPorts.has(port) ? 'true' : 'false';
        const configYaml = `
client_secret: ${NEZHA_KEY}
debug: false
disable_auto_update: true
disable_command_execute: false
disable_force_update: true
disable_nat: false
disable_send_query: false
gpu: false
insecure_tls: true
ip_report_period: 1800
report_delay: 4
server: ${NEZHA_SERVER}
skip_connection_count: true
skip_procs_count: true
temperature: false
tls: ${nezhatls}
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: ${UUID}`;

        fs.writeFileSync(path.join(FILE_PATH, 'config.yaml'), configYaml);

        const command = `nohup ${phpPath} -c "${FILE_PATH}/config.yaml" >/dev/null 2>&1 &`;
        try {
            await exec(command);
            console.log(`${phpName} is running`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
            console.error(`php running error: ${error}`);
        }
    } else {
        console.log('NEZHA variable is empty,skip running');
    }
    const command1 = `nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`;
    try {
        await exec(command1);
        console.log(`${webName} is running`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
        console.error(`web running error: ${error}`);
    }

    if (fs.existsSync(botPath) && ARGO_AUTH) {
        let args = ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)
            ? `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`
            : `tunnel --edge-ip-version auto --config ${FILE_PATH}/tunnel.yml run`;

        try {
            await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
            console.log(`${botName} is running`);
            await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
            console.error(`Error executing command: ${error}`);
        }
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));

}

function getFilesForArchitecture(architecture) {
    let baseFiles;
    const baseUrl = "https://raw.githubusercontent.com/sz30/appa/main";

    if (architecture === 'arm') {
        baseFiles = [
            { fileName: webPath, fileUrl: `${baseUrl}/arm64/web` },
            { fileName: botPath, fileUrl: `${baseUrl}/arm64/bot` }
        ];
    } else {
        baseFiles = [
            { fileName: webPath, fileUrl: `${baseUrl}/amd64/web` },
            { fileName: botPath, fileUrl: `${baseUrl}/amd64/bot` }
        ];
    }
    if (NEZHA_SERVER && NEZHA_KEY) {
        const v1Path = architecture === 'arm' ? 'arm64/v1' : 'amd64/v1';
        baseFiles.unshift({
            fileName: phpPath,
            fileUrl: `${baseUrl}/${v1Path}`
        });
    }
    return baseFiles;
}

function argoType() {
    if (ARGO_AUTH && ARGO_DOMAIN && ARGO_AUTH.includes('TunnelSecret')) {
        fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), ARGO_AUTH);
        const tunnelYaml = `
  tunnel: ${ARGO_AUTH.split('"')[11]}
  credentials-file: ${path.join(FILE_PATH, 'tunnel.json')}
  protocol: http2
  
  ingress:
    - hostname: ${ARGO_DOMAIN}
      service: http://localhost:${ARGO_PORT}
      originRequest:
        noTLSVerify: true
    - service: http_status:404
  `;
        fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), tunnelYaml);
    }
}

async function getMetaInfo() {
    try {
        const response1 = await axios.get('https://api.ip.sb/geoip', { headers: { 'User-Agent': 'Mozilla/5.0', timeout: 3000 } });
        if (response1.data && response1.data.country_code && response1.data.isp) {
            return `${response1.data.country_code}-${response1.data.isp}`.replace(/\s+/g, '_');
        }
    } catch (error) {
        const response2 = await axios.get('http://ip-api.com/json', { headers: { 'User-Agent': 'Mozilla/5.0', timeout: 3000 } });
        if (response2.data && response2.data.status === 'success' && response2.data.countryCode && response2.data.org) {
            return `${response2.data.countryCode}-${response2.data.org}`.replace(/\s+/g, '_');
        }
    }
    return 'Unknown';
}

async function generateLinks(argoDomain) {
    const ISP = await getMetaInfo();
    const nodeName = NAME ? `${NAME}-${ISP}` : ISP;
    return new Promise((resolve) => {
        setTimeout(() => {
            const VMESS = { v: '2', ps: `${nodeName}`, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: argoDomain, path: '/vmess-argo?ed=2560', tls: 'tls', sni: argoDomain, alpn: '', fp: 'firefox' };
            const subTxt = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Fvless-argo%3Fed%3D2560#${nodeName}

vmess://${Buffer.from(JSON.stringify(VMESS)).toString('base64')}

trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Ftrojan-argo%3Fed%3D2560#${nodeName}
  `;
            console.log(Buffer.from(subTxt).toString('base64'));
            fs.writeFileSync(subPath, Buffer.from(subTxt).toString('base64'));
            console.log(`${FILE_PATH}/sub.txt saved successfully`);
            app.get(`/${SUB_PATH}`, (req, res) => {
                const encodedContent = Buffer.from(subTxt).toString('base64');
                res.set('Content-Type', 'text/plain; charset=utf-8');
                res.send(encodedContent);
            });
            resolve(subTxt);
        }, 2000);
    });
}

function cleanFiles() {
    setTimeout(() => {
        const filesToDelete = [configPath, webPath, botPath];

        if (NEZHA_SERVER && NEZHA_KEY) {
            filesToDelete.push(phpPath);
        }

        if (process.platform === 'win32') {
            exec(`del /f /q ${filesToDelete.join(' ')} > nul 2>&1`, (error) => {
                console.clear();
                console.log('App is running');
                console.log('Thank you for using this script, enjoy!');
            });
        } else {
            exec(`rm -rf ${filesToDelete.join(' ')} >/dev/null 2>&1`, (error) => {
                console.clear();
                console.log('App is running');
                console.log('Thank you for using this script, enjoy!');
            });
        }
    }, 90000); // 90s
}

async function startserver() {
    try {
        argoType();
        await generateConfig();
        await downloadFilesAndRun();

        if (ARGO_DOMAIN) {
            await generateLinks(ARGO_DOMAIN);
        }
        cleanFiles();
    } catch (error) {
        console.error('Error in startserver:', error);
    }
}
startserver().catch(error => {
    console.error('Unhandled error in startserver:', error);
});

app.get("/", async function (req, res) {
    try {
        const filePath = path.join(__dirname, 'index.html');
        const data = await fs.promises.readFile(filePath, 'utf8');
        res.send(data);
    } catch (err) {
        res.send("Hello world!<br><br>You can access /{SUB_PATH}(Default: /sub) to get your nodes!");
    }
});

app.listen(PORT, () => console.log(`http server is running on port:${PORT}!`));