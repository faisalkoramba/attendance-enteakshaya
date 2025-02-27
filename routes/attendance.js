const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

// Function to calculate distance between two points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
}

// Updated verification function with better debugging
function verifyLocation(latitude, longitude, allowedLocations) {
    console.log("User's current coordinates:", latitude, longitude);
    const MAX_ALLOWED_DISTANCE = 50; // Increased to 300 meters for testing
    
    try {
        // Check if the input is valid
        if (!latitude || !longitude) {
            return { verified: false, message: 'Invalid location data provided' };
        }

        // Log all location comparisons for debugging
        const locationDistances = [];
        
        // Check against each allowed location
        for (const [locationName, coords] of Object.entries(allowedLocations)) {
            const distance = calculateDistance(
                latitude, 
                longitude, 
                coords.lat, 
                coords.lng
            );
            
            locationDistances.push({
                name: locationName,
                authorizedCoords: coords,
                userDistance: Math.round(distance)
            });
            
            if (distance <= MAX_ALLOWED_DISTANCE) {
                console.log(`Location verified: ${locationName} - Distance: ${Math.round(distance)}m`);
                return { 
                    verified: true, 
                    location: locationName,
                    distance: Math.round(distance)
                };
            }
        }

        // Log detailed information for debugging
        console.log("Location verification failed. Distance details:", JSON.stringify(locationDistances, null, 2));
        
        return { 
            verified: false, 
            message: 'You are not at an authorized location',
            debug: {
                userCoordinates: { lat: latitude, lng: longitude },
                locationDistances
            }
        };
    } catch (error) {
        console.error("Error in verifyLocation:", error);
        return { verified: false, message: 'Error in location verification process' };
    }
}

// Function to fetch data from Google Sheets
async function fetchSheetData(sheets, spreadsheetId, ranges) {
    const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
    });
    return response.data.valueRanges.map(range => range.values || []);
}

// Verify employee from QR code
router.post('/verify-employee', async (req, res) => {
    try {
        const { employeeId } = req.body;
        const auth = req.app.locals.auth;
        const spreadsheetId = req.app.locals.spreadsheetId;
        const sheets = google.sheets({ version: 'v4', auth });

        const [employees, attendance] = await fetchSheetData(sheets, spreadsheetId, ['employees!A:F', 'attendance!A:H']);
        
        const employee = employees.find(row => row[0] === employeeId);
        if (!employee) {
            return res.json({ success: false, message: 'Employee not found' });
        }

        const lastAttendance = attendance
            .filter(row => row[1] === employeeId)
            .pop();

        res.json({
            success: true,
            employee: {
                id: employee[0],
                name: employee[1],
                department: employee[2],
                phone: employee[3],
                email: employee[4],
                photoUrl: employee[5],
                lastAttendance: lastAttendance ? {
                    checkIn: lastAttendance[5],
                    checkOut: lastAttendance[6],
                    totalHours: lastAttendance[7],
                } : null,
            },
        });
    } catch (error) {
        console.error('Error verifying employee:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

// Record attendance with enhanced debugging
router.post('/record-attendance', async (req, res) => {
    try {
        const { employeeId, action, timestamp, location } = req.body;
        const allowedLocations = req.app.locals.allowedLocations || {
            "ECS OFFICE": { lat: 11.235443818092909, lng: 76.05030729511002 }
        };

        console.log("Allowed locations:", JSON.stringify(allowedLocations, null, 2));
        
        if (!location || !location.latitude || !location.longitude) {
            return res.json({ success: false, message: 'Location data is required' });
        }

        const locationVerification = verifyLocation(
            location.latitude, 
            location.longitude,
            allowedLocations
        );
        
        if (!locationVerification.verified) {
            // Add debug information in development
            if (process.env.NODE_ENV !== 'production') {
                return res.json({ 
                    success: false, 
                    message: locationVerification.message || 'Unauthorized location',
                    debug: locationVerification.debug
                });
            }
            return res.json({ 
                success: false, 
                message: locationVerification.message || 'Unauthorized location'
            });
        }

        const auth = req.app.locals.auth;
        const spreadsheetId = req.app.locals.spreadsheetId;
        const sheets = google.sheets({ version: 'v4', auth });
        
        const [employees, attendance] = await fetchSheetData(sheets, spreadsheetId, ['employees!A:C', 'attendance!A:H']);
        const employee = employees.find(row => row[0] === employeeId);
        if (!employee) {
            return res.json({ success: false, message: 'Employee not found' });
        }

        const currentTime = new Date();
        const formattedTime = currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        let totalHours = '';

        if (action === 'Check-Out') {
            const lastCheckIn = attendance.filter(row => row[1] === employeeId && row[4] === 'Check-In').pop();
            if (lastCheckIn) {
                const checkInTime = new Date(lastCheckIn[0]);
                totalHours = ((currentTime - checkInTime) / (1000 * 60 * 60)).toFixed(1) + 'h';
            }
        }

        const values = [[
            currentTime.toISOString(),
            employeeId,
            employee[1],
            locationVerification.location,
            action,
            action === 'Check-In' ? formattedTime : '',
            action === 'Check-Out' ? formattedTime : '',
            totalHours
        ]];

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'attendance!A:H',
            valueInputOption: 'USER_ENTERED',
            resource: { values },
        });

        res.json({
            success: true,
            checkInTime: action === 'Check-In' ? formattedTime : undefined,
            checkOutTime: action === 'Check-Out' ? formattedTime : undefined,
            totalHours,
            location: locationVerification.location,
            distance: locationVerification.distance
        });
    } catch (error) {
        console.error('Error recording attendance:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

module.exports = router;