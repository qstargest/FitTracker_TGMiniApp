/**
 * FitTrack - Telegram Mini App Logic
 */

// Initialize Telegram WebApp
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Configuration
const CONFIG = {
    GOAL: 10000,
    STEP_CALORIES: 0.04,
    STEP_DISTANCE: 0.00075, // km
    THRESHOLD: 3,
    MIN_STEP_MS: 300,
    WEEK_DAYS: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
};

// Application State
const state = {
    steps: 0,
    running: false,
    startTime: null,
    timer: null,
    demoInterval: null,
    motionHandler: null,
    lastMag: 0,
    lastPeakTime: 0,
    weekData: [4200, 7800, 6100, 9300, 5500, 8900, 0] // Mock data
};

// DOM Elements
const elements = {
    stepCount: document.getElementById('stepCount'),
    progressFill: document.getElementById('progressFill'),
    progressPct: document.getElementById('progressPct'),
    calVal: document.getElementById('calVal'),
    distVal: document.getElementById('distVal'),
    timeVal: document.getElementById('timeVal'),
    tempoVal: document.getElementById('tempoVal'),
    recBtn: document.getElementById('recBtn'),
    recLabel: document.getElementById('recLabel'),
    btnIcon: document.getElementById('btn-icon'),
    weekBars: document.getElementById('weekBars'),
    userName: document.getElementById('user-name'),
    currentTime: document.getElementById('current-time')
};

/**
 * Initialize Application
 */
function init() {
    // Set User Name from Telegram
    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        elements.userName.textContent = tg.initDataUnsafe.user.first_name;
    }

    // Setup Event Listeners
    elements.recBtn.addEventListener('click', togglePedometer);
    
    // Update Clock
    setInterval(updateClock, 1000);
    updateClock();

    // Initial Render
    renderWeek();
    updateUI();
}

/**
 * Update UI Elements
 */
function updateUI() {
    const pct = Math.min(Math.round((state.steps / CONFIG.GOAL) * 100), 100);
    
    // Animate count if large change? For now just set.
    elements.stepCount.textContent = state.steps.toLocaleString('ru');
    elements.progressFill.style.width = pct + '%';
    elements.progressPct.textContent = pct + '%';
    
    elements.calVal.textContent = Math.round(state.steps * CONFIG.STEP_CALORIES);
    elements.distVal.textContent = (state.steps * CONFIG.STEP_DISTANCE).toFixed(2);
    
    if (state.running && state.startTime) {
        const mins = Math.floor((Date.now() - state.startTime) / 60000);
        elements.timeVal.textContent = mins;
        
        if (mins > 0) {
            const pace = (state.steps / mins).toFixed(0);
            elements.tempoVal.innerHTML = `${pace} <small>ш/м</small>`;
        }
    }

    // Update current day in chart
    state.weekData[6] = state.steps;
    updateWeekBars();
}

/**
 * Toggle Pedometer State
 */
function togglePedometer() {
    state.running = !state.running;

    if (state.running) {
        startTracking();
    } else {
        stopTracking();
    }
}

function startTracking() {
    elements.recBtn.classList.add('active');
    elements.recLabel.textContent = 'Тренировка...';
    elements.btnIcon.className = 'ti ti-player-pause-filled';
    
    state.startTime = Date.now();
    state.hasMotionData = false;
    state.stepCountAtStart = state.steps;
    
    // Try real sensors first
    if (typeof DeviceMotionEvent !== 'undefined') {
        startRealPedometer();
        
        // Safety fallback: if no motion detected in 10s, use demo
        state.fallbackTimeout = setTimeout(() => {
            if (!state.hasMotionData && state.running) {
                console.log('Нет данных сенсора — демо-режим');
                startDemoPedometer();
            }
        }, 3000);


    state.stepFallbackTimeout = setTimeout(() => {
            if (state.hasMotionData && state.steps === state.stepCountAtStart && state.running) {
                console.log('Сенсор есть, шаги не считаются — демо-режим');
                startDemoPedometer();
            }
        }, 5000);
    } else {
        startDemoPedometer();
    }

    state.timer = setInterval(updateUI, 1000);

    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
}

function stopTracking() {
    elements.recBtn.classList.remove('active');
    elements.recLabel.textContent = 'Начать тренировку';
    elements.btnIcon.className = 'ti ti-player-play-filled';
    
    clearInterval(state.timer);
    if (state.demoInterval) clearInterval(state.demoInterval);
    if (state.stepFallbackTimeout) clearTimeout(state.stepFallbackTimeout);
    
    if (state.motionHandler) {
        window.removeEventListener('devicemotion', state.motionHandler);
        state.motionHandler = null;
    }
    
    elements.tempoVal.textContent = '—';
    
    if (tg.HapticFeedback) {
        tg.HapticFeedback.impactOccurred('medium');
    }
}

/**
 * Pedometer Logic
 */
function startRealPedometer() {
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission().then(response => {
            if (response === 'granted') {
                attachMotion();
            } else {
                startDemoPedometer();
            }
        }).catch(err => {
            console.error('Permission error:', err);
            startDemoPedometer();
        });
    } else {
        attachMotion();
    }
}

function attachMotion() {
    let lastValues = [];

    state.motionHandler = (e) => {
        const a = e.accelerationIncludingGravity || e.acceleration;
        if (!a) return;

        const x = a.x || 0, y = a.y || 0, z = a.z || 0;
        if (x === 0 && y === 0 && z === 0) return;
        
        state.hasMotionData = true; // We are getting signals!
        
        const mag = Math.sqrt(x * x + y * y + z * z);
        lastValues.push(mag);
        if (lastValues.length > 4) lastValues.shift();

        const avg = lastValues.reduce((s, v) => s + v, 0) / lastValues.length;
        const delta = Math.abs(mag - avg);
        const now = Date.now();
        
        // Initialize lastMag on first run to avoid jump
        //if (state.lastMag === 0) {
            //state.lastMag = mag;
           // return;
        //}
        
        // Adjusted threshold for better sensitivity
        if (delta > CONFIG.THRESHOLD && (now - state.lastPeakTime) > CONFIG.MIN_STEP_MS) {
            registerStep();
            state.lastPeakTime = now;
        }
        state.lastMag = mag;
    };
    window.addEventListener('devicemotion', state.motionHandler);
}

function registerStep() {
    state.steps++;
    updateUI();
    
    // Add a tiny animation effect to the number
    elements.stepCount.classList.remove('bump');
    void elements.stepCount.offsetWidth; // Trigger reflow
    elements.stepCount.classList.add('bump');

    if (tg.HapticFeedback && state.steps % 10 === 0) {
        tg.HapticFeedback.impactOccurred('light');
    }
}

function startDemoPedometer() {
    if (state.demoInterval) return;
    console.log('Demo mode active');
    let acc = 0;
    state.demoInterval = setInterval(() => {
        acc += Math.random() * 0.45;
        if (acc >= 1) {
            const add = Math.floor(acc);
            for(let i=0; i<add; i++) registerStep();
            acc -= add;
        }
    }, 400);
}

/**
 * Week Chart Rendering
 */
function renderWeek() {
    const maxVal = Math.max(...state.weekData, 1000);
    elements.weekBars.innerHTML = state.weekData.map((val, i) => `
        <div class="bar-wrapper">
            <div class="bar ${i === 6 ? 'active' : ''}" id="bar-${i}" style="height: ${(val / maxVal * 100)}%"></div>
            <span class="bar-label">${CONFIG.WEEK_DAYS[i]}</span>
        </div>
    `).join('');
}

function updateWeekBars() {
    const maxVal = Math.max(...state.weekData, 1000);
    state.weekData.forEach((val, i) => {
        const bar = document.getElementById(`bar-${i}`);
        if (bar) {
            bar.style.height = `${(val / maxVal * 100)}%`;
        }
    });
}

/**
 * Helper Functions
 */
function updateClock() {
    const now = new Date();
    elements.currentTime.textContent = now.toLocaleTimeString('ru', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}

// Start the App
document.addEventListener('DOMContentLoaded', init);
