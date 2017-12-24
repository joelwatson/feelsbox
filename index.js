import Matrix from 'rpi-ws281x-native';
import io from 'socket.io-client';
import request from 'request';
import {Gpio} from 'onoff';

import {apiKey, latitude, longitude} from './config';
import {love} from './pixels/default-emoji';
import numbers from './pixels/numbers';

const ledCount = 64;
const socket = io('https://feelsbox.herokuapp.com', {forceNew: true});
const weatherEndPoint = 'https://api.darksky.net/forecast';
const toggle = new Gpio(4, 'in', 'both');
let viewState = 0;
let currentWeather = {};
let weatherReqFn;

toggle.watch((err, value) => {
    if (!err && value) {
        setViewState();
    }
});

const getWeather = () => { 
    const opts = {
        url: `https://api.darksky.net/forecast/${apiKey}/${latitude}, ${longitude}`,
        method: 'GET',
        json: true
    };
    request(opts, (err, response, data) => {
        let low, high;
        const {
            currently: {
                icon, 
                temperature: current, 
                apparentTemperature: feelslike
            } = {}, 
            daily: {
                data: weather = []
            } = {}
        } = data;
        
        weather.forEach(item => {
            const {temperatureLow: min, temperatureHigh: max} = item;
            
            if (low === undefined || min < low) {
                low = min;
            }

            if (high === undefined || max > high) {
                high = max;
            }
        });

        renderWeather({
            icon,
            current,
            feelslike: parseInt(feelslike),
            low,
            high
        });
    });
};

const renderWeather = weather => {
    const {feelslike, icon} = weather;
    const temperature = Math.min(Math.abs(feelslike), 99).toString().split('');
    const pixelData = new Uint32Array(ledCount);
    let borderColor;
    
    if (temperature.length === 1) {
        // normalize entry to we always have 2 places
        temperature.unshift('_');
    }

    // initialize Matrix if not already initialized
    if (Matrix.state !== 'weather') {
        Matrix.init(ledCount, {brightness: 20});
        Matrix.state = 'weather';
    }

    temperature.forEach((entry, index) => {
        if (entry === '_') {
            return;
        }

        const digit = numbers[entry];
        const offset = index === 0 ? 0 : 3;
        let start = 9 + offset;
        let current = start;

        // loop over rows      
        for (let i=0; i<5; i++) {
            start = start + 8;
            current = start - 1;

            digit[i].forEach((row, idx) => {
                current++;
                if (row) {
                    pixelData[invertValue(current)] = '0xffffff';
                }                
            });
        }
    });

    Matrix.render(pixelData);
};

const showFeeling = feeling => {
    Matrix.init(ledCount, {brightness: 50});
    Matrix.state = 'feeling';
    const pixelData = new Uint32Array(ledCount);

    feeling.forEach(function (item) {
        const {i, c} = item;
        pixelData[invertValue(i-1)] = `0x${c}`;
    });
    console.log('a feeling happened');
    Matrix.render(pixelData);
};

const clearMatrix = () => {
    const {state = null} = Matrix;

    if (state) {
        Matrix.reset();
        delete Matrix.state;
    }

     clearInterval(weatherReqFn);    
};

const setViewState = () => {
    // we always need to clear the matrix between states
    clearMatrix();

    switch(viewState) {
        case 1: // emoji
            viewState = 2;
            getWeather();
            //weatherReqFn = setInterval(getWeather, 600000);
	        break;
	    case 2: // weather
            viewState = 0;
	        break;
	    default: // screen off
            viewState = 1;
            showFeeling(love);
	        break;
    }
};

const invertValue = value => {
    const row = parseInt(value / 8);
    const needsInversion = !(row % 2);
    let fixedValue = value;

    if (needsInversion) {
        const rowStart = row * 8;
        const rowEnd = rowStart + 7;
        const distanceFromStart = value - rowStart;
        
        fixedValue = rowEnd - distanceFromStart;
    }

    return fixedValue;
};

const exitHandler = () => {
    socket.close();
    clearMatrix();
    clearInterval(weatherReqFn);
    process.exit();
}

socket.on('emote', feeling => {
    viewState = 1;
    showFeeling(feeling);
});

socket.on('stop', () => {
    Matrix.reset();
    clearInterval(weatherReqFn);
});

socket.on('weather', () => {
    weatherReqFn = setInterval(getWeather, 600000);
});

//catches ctrl+c event
process.on('SIGINT', exitHandler);

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler);
process.on('SIGUSR2', exitHandler);

//catches uncaught exceptions
process.on('uncaughtException', exitHandler);


