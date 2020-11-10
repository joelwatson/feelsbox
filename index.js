import Matrix from 'rpi-ws281x-native';
import io from 'socket.io-client';
import request from 'request';
import {Gpio} from 'onoff';
import shelljs from 'shelljs';

import config from './config';
import {love} from './pixels/default-emoji';
import numbers from './pixels/numbers';
import {icons, iconmap} from './pixels/weather';

const {apiKey, latitude, longitude, room} = config;
const ledCount = 64;
const socket = io('https://feelsbox-server-v2.herokuapp.com', {forceNew: true});
const weatherEndPoint = 'https://api.darksky.net/forecast';
const toggle = new Gpio(4, 'in', 'both');
const timers = [];

let viewState = 0;
var downTime = 0;
var clickBuffer;

// configure the ws281x strip
Matrix.init(ledCount);

socket.emit('joinroom', room);

setInterval(() => {
    socket.emit('joinroom', room);
}, 60000)

/*toggle.watch((err, value) => {
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
});*/

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
    // noop; need to remove
};

const setViewState = initMatrix => {
    switch(viewState) {
        case 1: // emoji
            viewState = 2;

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

    process.nextTick(() => {
        process.exit();
    });
}

socket.on('emote', data => {
    clearMatrix();

    viewState = 1;

    showFeeling(data);
});

socket.on('restart', restart);

socket.on('stop', () => {
    Matrix.reset();
});

socket.on('weather', () => {
    viewState = 1;
});

// catches ctrl+c event
process.on('SIGINT', exitHandler);

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler);
process.on('SIGUSR2', exitHandler);

// catches uncaught exceptions
process.on('uncaughtException', exitHandler);

setTimeout(setViewState, 500);
