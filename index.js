import Matrix from 'rpi-ws281x-native';
import io from 'socket.io-client';
import request from 'request';
import {apiKey, latitude, longitude} from './config';

const ledCount = 64;
const socket = io('http://localhost:3000');
const weatherEndPoint = 'https://api.darksky.net/forecast';
let currentWeather = {};
let weatherReqFn;

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
        
        currentWeather = {
            icon,
            current,
            feelslike,
            low,
            high
        };
    });
};

socket.on('emote', feeling => {
    Matrix.init(ledCount, {brightness: 50});
    const pixelData = new Uint32Array(ledCount);

    feeling.forEach(function (item) {
        const {i, c} = item;
        pixelData[i-1] = `0x${c}`;
    });

    Matrix.render(pixelData);
});

socket.on('stop', () => {
    Matrix.reset();
    clearInterval(weatherReqFn);
});

socket.on('weather', () => {
    getWeather();
    //weatherReqFn = setInterval(getWeather, 600000);
});

function exitHandler() {
    Matrix.reset();
    clearInterval(weatherReqFn);
}

//do something when app is closing
process.on('exit', exitHandler);

//catches ctrl+c event
process.on('SIGINT', exitHandler);

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler);
process.on('SIGUSR2', exitHandler);

//catches uncaught exceptions
process.on('uncaughtException', exitHandler);


