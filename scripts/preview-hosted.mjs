import express from 'express';
import handler from '../api/proxy.mjs';
const app = express();
app.use(express.json());
app.use('/api', (req, res) => handler({ method: req.method, query: { ...req.query, route: req.path.slice(1) }, headers: req.headers, body: req.body }, res));
app.use(express.static('dist'));
app.listen(3019, '127.0.0.1', () => console.log('Hosted-demo preview: http://localhost:3019'));
