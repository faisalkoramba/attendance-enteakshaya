require('dotenv').config();
const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const cors = require('cors');
const attendanceRouter = require('./routes/attendance');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(cors()); // Allow cross-origin requests (if needed)

// Initialize Google Sheets API
const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

const auth = new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});


// Make auth available to routes
app.locals.auth = auth;
app.locals.spreadsheetId = process.env.SPREADSHEET_ID;

// Routes
app.use('/api', attendanceRouter);

// Serve the main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error("Error:", err.stack);
    if (req.originalUrl.startsWith('/api')) {
        return res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
    res.status(500).send('Something broke!');
});

// Start the server
app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
});
