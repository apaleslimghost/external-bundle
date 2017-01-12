const http = require('http');
const url = require('url');
const browserify = require('browserify');
const spawn = require('cross-spawn-promise');
const fs = require('mz/fs');
const path = require('path');
const handle = require('@quarterto/handle-promise');
const packageArg = require('npm-package-arg');

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

const createBundle = (modules, basedir) => {
	const bundle = browserify({basedir});
	modules.forEach(module => bundle.require(module));
	return new Promise((resolve, reject) => {
		bundle.bundle((err, content) => {
			if(err) {
				reject(err);
			} else {
				resolve(content.toString());
			}
		});
	});
}

const app = http.createServer(handle(async (req, res) => {
	const {pathname} = url.parse(req.url, true);
	if(pathname === '/favicon.ico') return res.end();

	const modules = decodeURIComponent(pathname.slice(1)).split(';');
	const dir = await npmInstall(modules);
	const moduleNames = modules.map(module => packageArg(module).name);
	const bundle = await createBundle(moduleNames, dir);
	res.setHeader('content-type', 'application/javascript');
	res.end(bundle);
}));

app.listen(process.env.PORT || 8153);