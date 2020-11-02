import Matrix from 'rpi-ws281x-native';
import io from 'socket.io-client';
import request from 'request';
import {Gpio} from 'onoff';
import shelljs from 'shelljs';

import {apiKey, latitude, longitude, room} from './config';
import {love} from './pixels/default-emoji';
import numbers from './pixels/numbers';
import {icons, iconmap} from './pixels/weather';

const ledCount = 64;
const socket = io('https://feelsbox-server-v2.herokuapp.com', {forceNew: true});
const weatherEndPoint = 'https://api.darksky.net/forecast';
const toggle = new Gpio(4, 'in', 'both');
const timers = [];

let viewState = 0;
let currentWeather = {};
var weatherReqFn;
var weatherTimerFn;
var weatherIconTimerFn;
var downTime = 0;
var clickBuffer;

socket.emit('joinroom', room);

setInterval(() => {
    socket.emit('joinroom', room);
}, 60000)

toggle.watch((err, value) => {
    if (value === 0) {
        downTime = new Date().getTime();
    } else if (value === 1) {
        // get timer diff
        const diff = new Date().getTime() - downTime;
        // if diff is greater than 5 seconds, shutdown
        if (downTime !== 0 && diff >= 5000) {
            console.log(diff, 'restart');
            restart();
            return;
        }
    }

    if (!err && value) {
        // if any clicks are already in progress, clear them
        clearTimeout(clickBuffer);
        clickBuffer = setTimeout(() => {
            console.log('button up', viewState);
            setViewState();
            clickBuffer = null;
            // clear downtime
            downTime = 0;
	}, 300);
    }
});

const getWeather = () => {
    const opts = {
        url: `https://api.darksky.net/forecast/${apiKey}/${latitude}, ${longitude}?exclude=minutely,hourly,daily,alerts,flags`,
        method: 'GET',
        json: true
    };

    request(opts, (err, response, data) => {
        console.log(err)
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
            //low,
            //high
        });
    });
};

const renderWeatherDisplay = weather => {
    const pixelData = new Uint32Array(ledCount);
    const {icon, feelslike} = weather;
    const temperature = Math.min(Math.abs(feelslike), 99).toString().split('');
    let borderColor;

    if (feelslike <= 32) {
        // dark blue
        borderColor = '0x0000cc';
    } else if (feelslike > 32 && feelslike < 65) {
        // light blue
        borderColor = '0xadd8e6';
    } else if (feelslike >= 65 && feelslike < 85) {
        // green
        borderColor = '0x008000';
    } else {
        // orange
        borderColor = '0xff4500';
    }

    temperature.forEach((entry, index) => {
        let offset = 0;

        if (index === 0 && temperature.length ===1) {
            offset = 2;
        } else {
            offset = index === 0 ? 0 : 4
        }

        const digit = numbers[entry];
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

    // create temperature border
    let border= [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
        16, 24, 32, 40, 48,
        //23, 31, 39, 47, 55,
        56, 57, 58, 59, 60, 61, 62, 63
    ];

    if (temperature.length === 1) {
        border = border.concat([23, 31, 39, 47, 55]);
    }


    border.forEach(index => {
        pixelData[invertValue(index)] = borderColor;
    });

    Matrix.render(pixelData);

    weatherIconTimerFn = setTimeout(() => {
        renderWeatherIcon(weather);
    }, 10000);
}

const renderWeatherIcon = weather => {
    const {icon, feelslike} = weather;
    const pixelData = new Uint32Array(ledCount);
    const iconPixels = icons[iconmap[icon]] || icons['sun'];

    iconPixels.forEach(function (item) {
        const {i, c} = item;
        pixelData[invertValue(i-1)] = `0x${c}`;
    });

    Matrix.render(pixelData);

    weatherTimerFn = setTimeout(() => {
        renderWeatherDisplay(weather);
    }, 10000);
};

const renderWeather = weather => {
    // initialize Matrix if not already initialized
    if (Matrix.state !== 'weather') {
        Matrix.init(ledCount, {brightness: 20});
        Matrix.state = 'weather';
    }

    renderWeatherDisplay(weather);
};

const sleep = duration => {
    return new Promise(resolve => {
	const timer = setTimeout(resolve, duration);

        timers.push(timer);
    });
};

const clearTimers = () => {
    timers.forEach(timer => {
        clearTimeout(timer);
    });

    timers.length = 0;
};

const showFeeling = async data => {
    const {feel} = data;
    const {duration: defaultDuration = 1000, frames = [], repeat = false, reverse = false} = feel;

    clearTimers();

    if (frames.length === 1) {
        const [frame] = frames;

        renderFrame(frame);
    } else {
        const loop = async(curFrames, skip) => {
            let idx = -1;

            for (const frame of curFrames) {
                idx++;

                if (idx === 0 && skip) {
                    continue;
                }

                const {duration: frameDuration} = frame;
                const duration = frameDuration || defaultDuration;

                renderFrame(frame);

                await sleep(duration);
            }

            if (repeat) {
                const frames = reverse ? curFrames.reverse() : curFrames;

                await loop(frames, reverse);
            }
        };

        await loop(frames);
    }
};

const renderFrame = frame => {
    const {brightness = 100, pixels = []} = frame;
    const pixelData = new Uint32Array(ledCount);

    Matrix.init(ledCount, {brightness});
    Matrix.state = 'feeling';

    Array.from(Array(64).keys()).forEach((row, idx) => {
        const pixel = pixels.find(pix => pix.position === idx);
        let color = '000';

        if (pixel) {
            ({color} = pixel);
        }

        pixelData[invertValue(idx)] = `0x${color}`;
    });

    Matrix.render(pixelData);
};

const clearMatrix = () => {
    const {state = null} = Matrix;

    if (state) {
        Matrix.reset();
        delete Matrix.state;
    }

    clearInterval(weatherReqFn);
    clearTimeout(weatherTimerFn);
    clearTimeout(weatherIconTimerFn);
};

const setViewState = () => {
    // we always need to clear the matrix between states
    clearMatrix();

    switch(viewState) {
        case 1: // emoji
            viewState = 2;
            getWeather();
            weatherReqFn = setInterval(getWeather, 600000);

            break;
        case 2: // weather
            viewState = 0;

            break;
	default: // screen off
            viewState = 1;
            showFeeling({feel: love});

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

const restart = () => {
    clearMatrix();
    console.log('restarting');
    shelljs.exec('reboot -h now');
};

const exitHandler = () => {
    socket.close();
    clearMatrix();
    clearInterval(weatherReqFn);
    process.exit();
}

socket.on('emote', data => {
    console.log('an emoji is happened');
    clearMatrix();
    viewState = 1;
    showFeeling(data);
});

socket.on('restart', restart);

socket.on('stop', () => {
    console.log('turning off display');
    Matrix.reset();
    clearInterval(weatherReqFn);
});

socket.on('weather', () => {
    viewState = 1;
    getWeather();
    weatherReqFn = setInterval(getWeather, 600000);
});

// catches ctrl+c event
process.on('SIGINT', exitHandler);

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler);
process.on('SIGUSR2', exitHandler);

// catches uncaught exceptions
process.on('uncaughtException', exitHandler);

setViewState();
