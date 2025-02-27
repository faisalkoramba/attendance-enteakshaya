class AttendanceSystem {
    constructor() {
        this.html5QrcodeScanner = null;
        this.currentEmployeeId = null;
        this.userLocation = null;
        this.allowedLocations = {
            "ECS OFFICE": { lat: 11.235443818092909, lng: 76.05030729511002 }
        };
        this.initializeElements();
        this.attachEventListeners();
        this.getCurrentLocation();
    }

    initializeElements() {
        this.scanButton = document.getElementById('scan-button');
        this.qrReader = document.getElementById('qr-reader');
        this.employeeDetails = document.getElementById('employee-details');
        this.statusMessage = document.getElementById('status-message');
        this.employeeName = document.getElementById('employee-name');
        this.employeeId = document.getElementById('employee-id');
        this.employeeDepartment = document.getElementById('employee-department');
        this.employeeEmail = document.getElementById('employee-email');
        this.employeePhone = document.getElementById('employee-phone');
        this.checkInTime = document.getElementById('check-in-time');
        this.checkOutTime = document.getElementById('check-out-time');
        this.totalHours = document.getElementById('total-hours');
    }

    attachEventListeners() {
        this.scanButton.addEventListener('click', () => this.startScanner());
        document.getElementById('check-in').addEventListener('click', () => this.recordAttendance('Check-In'));
        document.getElementById('check-out').addEventListener('click', () => this.recordAttendance('Check-Out'));
    }

    startScanner() {
        this.qrReader.style.display = 'block';
        this.html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: 250 });
        this.html5QrcodeScanner.render((decodedText) => {
            this.handleQRCodeScan(decodedText);
            setTimeout(() => {
                this.html5QrcodeScanner.clear();
                this.qrReader.style.display = 'none';
            }, 500);
        }, (error) => console.warn(`QR Code scanning failure: ${error}`));
    }

    async handleQRCodeScan(employeeId) {
        try {
            const response = await fetch('/api/verify-employee', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employeeId })
            });
            const data = await response.json();
            
            if (data.success) {
                this.currentEmployeeId = employeeId;
                this.displayEmployeeDetails(data.employee);
                this.showStatus('Employee verified successfully', 'success');
            } else {
                this.showStatus('Invalid Employee ID', 'error');
            }
        } catch (error) {
            this.showStatus('Error verifying employee', 'error');
            console.error('Error:', error);
        }
    }

    displayEmployeeDetails(employee) {
        this.employeeDetails.classList.remove('hidden');
        this.employeeName.textContent = employee.name;
        this.employeeId.textContent = employee.id;
        this.employeeDepartment.textContent = employee.department;
        this.employeeEmail.textContent = employee.email;
        this.employeePhone.textContent = employee.phone;
        this.checkInTime.textContent = employee.lastAttendance?.checkIn || '-';
        this.checkOutTime.textContent = employee.lastAttendance?.checkOut || '-';
        this.totalHours.textContent = employee.lastAttendance?.totalHours || '-';
    }

    async getCurrentLocation(retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                const position = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0
                    });
                });
    
                this.userLocation = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude
                };
    
                // Log the device's current location
                console.log(`Device Location: Latitude: ${this.userLocation.latitude}, Longitude: ${this.userLocation.longitude}`);
    
                return;
            } catch (error) {
                console.warn(`Location attempt ${i + 1} failed:`, error);
            }
        }
    
        this.showStatus('Please enable location services to mark attendance', 'error');
    }
    

    async recordAttendance(action) {
        if (!this.currentEmployeeId) {
            this.showStatus('Please scan QR code first', 'error');
            return;
        }
    
        if (!this.userLocation) {
            await this.getCurrentLocation();
            if (!this.userLocation) {
                this.showStatus('Location access is required to mark attendance', 'error');
                return;
            }
        }
    
        // Prevent multiple check-ins and check-outs
        if (action === 'Check-In' && this.checkInTime.textContent !== '-') {
            this.showStatus('You have already checked in', 'error');
            return;
        }
        if (action === 'Check-Out' && (this.checkInTime.textContent === '-' || this.checkOutTime.textContent !== '-')) {
            this.showStatus('Invalid check-out attempt', 'error');
            return;
        }
    
        const isValidLocation = Object.values(this.allowedLocations).some(loc => 
            this.calculateDistance(loc.lat, loc.lng, this.userLocation.latitude, this.userLocation.longitude) <= 0.3
        );
    
        if (!isValidLocation) {
            this.showStatus('You are not at an authorized location', 'error');
            return;
        }
    
        try {
            const response = await fetch('/api/record-attendance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    employeeId: this.currentEmployeeId,
                    action,
                    timestamp: new Date().toISOString(),
                    location: this.userLocation
                })
            });
            const data = await response.json();
    
            if (data.success) {
                this.showStatus(`${action} recorded successfully`, 'success');
                if (action === 'Check-In') {
                    this.checkInTime.textContent = data.checkInTime;
                    this.checkOutTime.textContent = '-';
                    this.totalHours.textContent = '-';
                } else {
                    this.checkOutTime.textContent = data.checkOutTime;
                    this.totalHours.textContent = data.totalHours;
                }
            } else {
                this.showStatus(data.message || `Failed to record ${action}`, 'error');
            }
        } catch (error) {
            this.showStatus('Error recording attendance', 'error');
            console.error('Error:', error);
        }
    }
    

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radius of Earth in km
        const dLat = (lat2 - lat1) * (Math.PI / 180);
        const dLon = (lon2 - lon1) * (Math.PI / 180);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    showStatus(message, type) {
        this.statusMessage.textContent = message;
        this.statusMessage.className = `status-message ${type}`;
        this.statusMessage.classList.remove('hidden');
        setTimeout(() => this.statusMessage.classList.add('hidden'), 3000);
    }
}

document.addEventListener('DOMContentLoaded', () => new AttendanceSystem());
