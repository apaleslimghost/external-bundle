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

const latestSatisfying = (name, range) => packageJson(name, range).then(({version}) => version);

const npmInstall = async modules => {
	const dir = (await fs.mkdtemp('modules/')) + '/node_modules';
	await fs.mkdir(dir);
	try {
		await spawn('npm', ['install', ...modules], {cwd: dir});
	} catch(e) {
		e.message = e.stderr.toString() + e.message;
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
		bundle.on('error', reject);
		modules.forEach(module => bundle.require(module));
		bundle.bundle((err, content) => {
			if(err) {
				reject(err);
			} else {
				resolve(content.toString());
			}
		});
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
	const dir = await npmInstall(modules);

	const args = modules.map(module => packageArg(module));
	const argsWithoutVersion = args.filter(({type}) => type !== 'version');

	if(argsWithoutVersion.length) {
		const withVersions = await Promise.all(argsWithoutVersion.map(async arg => {
			return arg.name + '@' + await latestSatisfying(arg.name, arg.spec);
		}));

		const redirectPath = '/' + withVersions.join(';');
		res.setHeader('location', redirectPath);
		res.statusCode = 308;
		return res.end();
	}

	const moduleNames = args.map(({name}) => name);
	const bundle = await createBundle(moduleNames, dir, query);

	res.setHeader('content-type', 'application/javascript');
	res.end(bundle);
}));

app.listen(process.env.PORT || 8153);