// Required dependencies
const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const validator = require('validator');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Store recent requests (last 10)
const recentRequests = [];
const MAX_REQUESTS_STORED = 10;

// Middleware to track requests
const requestLogger = (req, res, next) => {
    const request = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        query: req.query,
        body: req.method !== 'GET' ? req.body : undefined,
        ip: req.ip
    };

    recentRequests.unshift(request);
    if (recentRequests.length > MAX_REQUESTS_STORED) {
        recentRequests.pop();
    }
    next();
};

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});

// Middleware
app.use(helmet());
app.use(limiter);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(requestLogger);

// Serve static files
app.use(express.static('public'));

// Database configuration
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'ebilly',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Homepage route
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>API Request Monitor</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f5f5f5;
            }
            h1 {
                color: #333;
                text-align: center;
            }
            .request-container {
                background-color: white;
                border-radius: 8px;
                padding: 20px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .request-item {
                border-left: 4px solid #007bff;
                margin-bottom: 15px;
                padding: 10px;
                background-color: #f8f9fa;
            }
            .method {
                font-weight: bold;
                color: #007bff;
            }
            .timestamp {
                color: #666;
                font-size: 0.9em;
            }
            .path {
                color: #28a745;
            }
            .auto-refresh {
                text-align: center;
                margin-bottom: 20px;
            }
            pre {
                background-color: #f8f9fa;
                padding: 10px;
                border-radius: 4px;
                overflow-x: auto;
            }
        </style>
    </head>
    <body>
        <h1>API Request Monitor</h1>
        <div class="auto-refresh">
            Auto-refresh in <span id="timer">30</span> seconds
            <button onclick="toggleRefresh()" id="refreshToggle">Pause</button>
        </div>
        <div class="request-container" id="requestList">
            ${recentRequests.map(req => `
                <div class="request-item">
                    <div>
                        <span class="method">${req.method}</span>
                        <span class="path">${req.path}</span>
                    </div>
                    <div class="timestamp">${req.timestamp}</div>
                    ${req.query && Object.keys(req.query).length > 0 ? 
                        `<div>Query: <pre>${JSON.stringify(req.query, null, 2)}</pre></div>` : ''}
                    ${req.body ? 
                        `<div>Body: <pre>${JSON.stringify(req.body, null, 2)}</pre></div>` : ''}
                </div>
            `).join('')}
        </div>

        <script>
            let timer = 30;
            let intervalId;
            let isRefreshing = true;

            function updateTimer() {
                document.getElementById('timer').textContent = timer;
                if (timer === 0) {
                    location.reload();
                    timer = 30;
                } else {
                    timer--;
                }
            }

            function toggleRefresh() {
                const button = document.getElementById('refreshToggle');
                if (isRefreshing) {
                    clearInterval(intervalId);
                    button.textContent = 'Resume';
                } else {
                    startTimer();
                    button.textContent = 'Pause';
                }
                isRefreshing = !isRefreshing;
            }

            function startTimer() {
                timer = 30;
                intervalId = setInterval(updateTimer, 1000);
            }

            startTimer();
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

// Input validation middleware
const validateUserInput = (req, res, next) => {
    const { name, email, age } = req.body;
    const errors = [];

    if (!name || typeof name !== 'string' || name.length < 2) {
        errors.push('Invalid name');
    }

    if (!email || !validator.isEmail(email)) {
        errors.push('Invalid email');
    }

    if (!age || !Number.isInteger(Number(age)) || age < 0 || age > 120) {
        errors.push('Invalid age');
    }

    if (errors.length > 0) {
        return res.status(400).json({ errors });
    }

    next();
};

// Async error handler wrapper
const asyncHandler = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

// CREATE - Add a new user
app.post('/users', validateUserInput, asyncHandler(async (req, res) => {
    const { name, email, age } = req.body;
    
    const [result] = await pool.execute(
        'INSERT INTO users (name, email, age) VALUES (?, ?, ?)',
        [name, email, age]
    );

    res.status(201).json({
        message: 'User created successfully',
        userId: result.insertId
    });
}));

// READ - Get all users with pagination
app.get('/users', asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [users] = await pool.execute(
        'SELECT * FROM users LIMIT ? OFFSET ?',
        [limit, offset]
    );

    const [count] = await pool.execute('SELECT COUNT(*) as total FROM users');
    
    res.status(200).json({
        users,
        pagination: {
            currentPage: page,
            itemsPerPage: limit,
            totalItems: count[0].total,
            totalPages: Math.ceil(count[0].total / limit)
        }
    });
}));

// READ - Get user by ID
app.get('/users/:id', asyncHandler(async (req, res) => {
    const userId = req.params.id;

    const [users] = await pool.execute(
        'SELECT * FROM users WHERE id = ?',
        [userId]
    );

    if (users.length === 0) {
        return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(users[0]);
}));

// UPDATE - Update a user
app.put('/users/:id', validateUserInput, asyncHandler(async (req, res) => {
    const userId = req.params.id;
    const { name, email, age } = req.body;

    const [result] = await pool.execute(
        'UPDATE users SET name = ?, email = ?, age = ? WHERE id = ?',
        [name, email, age, userId]
    );

    if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({ message: 'User updated successfully' });
}));

// DELETE - Delete a user
app.delete('/users/:id', asyncHandler(async (req, res) => {
    const userId = req.params.id;

    const [result] = await pool.execute(
        'DELETE FROM users WHERE id = ?',
        [userId]
    );

    if (result.affectedRows === 0) {
        return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({ message: 'User deleted successfully' });
}));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    
    if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: 'Duplicate entry' });
    }

    res.status(500).json({ 
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

// Start the server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Closing HTTP server and DB pool...');
    await pool.end();
    process.exit(0);
});
// // Required dependencies
// const express = require('express');
// const mysql = require('mysql2');
// const bodyParser = require('body-parser');

// const app = express();
// const port = 3000;

// // Middleware
// app.use(bodyParser.json());
// app.use(bodyParser.urlencoded({ extended: true }));

// // MySQL Connection
// const connection = mysql.createConnection({
//     host: 'localhost',
//     user: 'root',
//     password: 'Sesi@143',
//     database: 'ebilly'
// });

// connection.connect((err) => {
//     if (err) {
//         console.error('Error connecting to MySQL database:', err);
//         return;
//     }
//     console.log('Connected to MySQL database');
// });

// // CREATE - Add a new user
// app.post('/users', (req, res) => {
//     const { name, email, age } = req.body;
    
//     const query = 'INSERT INTO users (name, email, age) VALUES (?, ?, ?)';
//     connection.query(query, [name, email, age], (err, results) => {
//         if (err) {
//             console.error('Error creating user:', err);
//             res.status(500).json({ error: 'Error creating user' });
//             return;
//         }
//         res.status(201).json({
//             message: 'User created successfully',
//             userId: results.insertId
//         });
//     });
// });

// // READ - Get all users
// app.get('/users', (req, res) => {
//     const query = 'SELECT * FROM users';
//     connection.query(query, (err, results) => {
//         if (err) {
//             console.error('Error fetching users:', err);
//             res.status(500).json({ error: 'Error fetching users' });
//             return;
//         }
//         res.status(200).json(results);
//     });
// });

// // READ - Get user by ID
// app.get('/users/:id', (req, res) => {
//     const userId = req.params.id;
//     const query = 'SELECT * FROM users WHERE id = ?';
    
//     connection.query(query, [userId], (err, results) => {
//         if (err) {
//             console.error('Error fetching user:', err);
//             res.status(500).json({ error: 'Error fetching user' });
//             return;
//         }
//         if (results.length === 0) {
//             res.status(404).json({ message: 'User not found' });
//             return;
//         }
//         res.status(200).json(results[0]);
//     });
// });

// // UPDATE - Update a user
// app.put('/users/:id', (req, res) => {
//     const userId = req.params.id;
//     const { name, email, age } = req.body;
    
//     const query = 'UPDATE users SET name = ?, email = ?, age = ? WHERE id = ?';
//     connection.query(query, [name, email, age, userId], (err, results) => {
//         if (err) {
//             console.error('Error updating user:', err);
//             res.status(500).json({ error: 'Error updating user' });
//             return;
//         }
//         if (results.affectedRows === 0) {
//             res.status(404).json({ message: 'User not found' });
//             return;
//         }
//         res.status(200).json({ message: 'User updated successfully' });
//     });
// });

// // DELETE - Delete a user
// app.delete('/users/:id', (req, res) => {
//     const userId = req.params.id;
//     const query = 'DELETE FROM users WHERE id = ?';
    
//     connection.query(query, [userId], (err, results) => {
//         if (err) {
//             console.error('Error deleting user:', err);
//             res.status(500).json({ error: 'Error deleting user' });
//             return;
//         }
//         if (results.affectedRows === 0) {
//             res.status(404).json({ message: 'User not found' });
//             return;
//         }
//         res.status(200).json({ message: 'User deleted successfully' });
//     });
// });

// // Error handling middleware
// app.use((err, req, res, next) => {
//     console.error(err.stack);
//     res.status(500).json({ error: 'Something went wrong!' });
// });

// // Start the server
// app.listen(port, () => {
//     console.log(`Server is running on port ${port}`);
// });



