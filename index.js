const http = require('http');
const url = require('url');
const browserify = require('browserify');
const spawn = require('cross-spawn-promise');
const fs = require('mz/fs');
const path = require('path');
const handle = require('@quarterto/handle-promise');
const packageArg = require('npm-package-arg');
const uglifyify = require('uglifyify');
const Uglify = require('uglify-js');
const envify = require('envify/custom');
const packageJson = require('package-json');
const crypto = require('crypto');
const mkdirp = require('mkdirp-promise');

const latestSatisfying = (name, range) => packageJson(name, range).then(({version}) => version);

const npmInstall = async args => {
	const stringArgs = args.map(arg => `${arg.name}@${arg.spec}`);
	const hash = crypto.createHash('sha256').update(stringArgs.join(' ')).digest('hex');
	const dir = `modules/${hash}/node_modules`;
	await mkdirp(dir);

	try {
		await spawn('npm', ['install', ...stringArgs], {cwd: dir});
	} catch(e) {
		if(e.stderr) e.message = e.stderr.toString() + e.message;
		throw e;
	}

	return dir;
};

const createBundle = (modules, basedir, {development} = {}) => {
	const bundle = browserify({basedir});

	if(development !== 'yes') {
		bundle.plugin(uglifyify, {global: true});
	}

	bundle.transform(envify({
		NODE_ENV: development === 'yes' ? 'development' : 'production'
	}));

	return new Promise((resolve, reject) => {
		try {
			bundle.on('error', reject);
			modules.forEach(module => bundle.require(module));
			bundle.bundle((err, content) => {
				if(err) {
					reject(err);
				} else {
					resolve(content.toString());
				}
			});
		} catch(e) {
			reject(e);
		}
	}).then(src => {
		if(development !== 'yes') {
			return Uglify.minify(src, {
				fromString: true,
			}).code;
		}

		return src;
	});
};

const app = http.createServer(handle(async (req, res) => {
	const {pathname, query} = url.parse(req.url, true);
	if(pathname === '/favicon.ico') return res.end();

	const modules = decodeURIComponent(pathname.slice(1)).split(';');
	const args = modules.map(module => packageArg(module));
	const argsWithoutVersion = args.some(({type}) => type !== 'version');

	if(argsWithoutVersion) {
		const withVersions = await Promise.all(args.map(async arg => {
			if(arg.type !== 'version') {
				arg.spec = await latestSatisfying(arg.name, arg.spec);
			}

			return `${arg.name}@${arg.spec}`;
		}));

		const redirectPath = '/' + withVersions.join(';');
		res.setHeader('location', redirectPath);
		res.statusCode = 308;
		return res.end();
	}

	const dir = await npmInstall(args);

	const moduleNames = args.map(({name}) => name);
	const bundle = await createBundle(moduleNames, dir, query);

	res.setHeader('cache-control', 'public, max-age=10000000000, immutable');
	res.setHeader('content-type', 'application/javascript');
	res.end(bundle);
}));

app.listen(process.env.PORT || 8153);