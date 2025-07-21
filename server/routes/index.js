// server/routes/index.js
const express = require('express');
const router = express.Router();

/* GET home page. */
// If you are using a client-side routing framework (like React Router)
// and serving a static index.html, you might not need this.
// `express.static` will typically serve `index.html` at the root automatically.
router.get('/', function(req, res, next) {
    // If you're rendering a view, ensure you have a view engine configured (e.g., app.set('view engine', 'pug')).
    // Otherwise, this will cause an error.
    res.render('index', { title: 'Express' });
});

module.exports = router;