/* eslint-disable  func-names */
/* eslint quote-props: ["error", "consistent"]*/

'use strict';

const Alexa = require('alexa-sdk');
const AmazonDateParser = require('amazon-date-parser')
const request = require('request');
const _ = require('lodash');
const moment = require('moment');

const APP_ID = process.env['ASK_APPID'];
const AUTH_TOKEN_OVERRIDE = process.env['AUTH_TOKEN_OVERRIDE'];
const TCUBE_API_URL = process.env['TCUBE_API_URL'] || 'https://tcube.technossus.com/api/';

function makeTCubeApiUrl(url) {
    const result = `${TCUBE_API_URL}${url}`;
    console.log(`Preparing to call '${result}'`);

    return result;
}

function getTimeEntryOnDate(date) {
    return new Promise(res => {
        res({
            project: 'a test project',
            date: date,
            subject: "a test entry!",
            hours: 8
        });
    });
}

function getTimeEntriesForThisWeek(authToken) {
    console.log('preparing to get entries for this week');

    return getTimeEntriesForWeekOf(authToken, moment().toDate());
}

function getTimeEntriesForWeekOf(authToken, date) {
    return new Promise((res, rej) => {
        try {
            const requestOptions = {
                headers: {
                    'Authorization': `Bearer ${authToken}`
                }
            };

            console.log(`attempting to get weeks to fetch for week of ${date}`);

            const weeksToFetch = moment().subtract(date).weeks();

            console.log(`calculated we need ${weeksToFetch} weeks back for ${date}`);

            // Get the current week's time sheet
            request.get(makeTCubeApiUrl(`TimeSheet/${weeksToFetch}`), requestOptions, (err, response, body) => {
                if (err) {
                    console.log(`error getting time sheet for ${date}`, JSON.stringify(err));
                    return rej(err);
                }

                const payload = JSON.parse(body);
                const timeSheet = _.last(payload.Grid);

                // Get the entries in the time sheet and map them so they're easily iterable
                request.get(makeTCubeApiUrl(`TimeEntryModel/${timeSheet.TimeSheetID}`), requestOptions, (err, response, body) => {
                    if (err) {
                        console.log('error getting this weeks timesheet: ', JSON.stringify(err));
                        return rej(err);
                    }

                    const payload = JSON.parse(body);
                    const entries = _(payload.Projects)
                        .flatMap(project => {
                            return _(project.TimeEntries)
                                .filter(entry => !entry.InvalidEntry)
                                .map(entry => {
                                    return {
                                        project: `${project.CompanyName} - ${project.ProjectName}`,
                                        date: moment(entry.Date),
                                        subject: entry.Subject,
                                        hours: entry.Hours
                                    };
                                })
                                .value();
                        })
                        .orderBy(entry => entry.date, "asc")
                        .value();

                    res(entries);
                });

            });
        } catch (e) {
            rej(e);
        }
    });
}

function processEntriesForWeek(entries, onSpeechGeneratedForDay) {
    // Group all entries by date so we can list them
    const entriesByDate = _.groupBy(entries, entry => entry.date);

    // Loop through our entries and describe them
    _.forIn(entriesByDate, (entriesForDate, date) => {
        const formattedDate = formatDate(date);
        const totalHoursWorked = _.sumBy(entriesForDate, entry => entry.hours);

        // Speech for all the time entries for the current day we're looking at 
        const speechForDay = _.reduce(entriesForDate, (acc, entry) => {
            return `${acc}\n${describeEntryWithoutDate(entry)}.`;
        }, '');

        onSpeechGeneratedForDay({
            date,
            formattedDate,
            speechForDay,
            entriesForDate,
            totalHoursWorked,
            recommendedSpeech: `\nHere's what you did on ${formattedDate}: ${speechForDay}`,
            recommendedCardContent: `\n\n${formattedDate}: ${totalHoursWorked} hours`
        });
    });
}

function formatDate(date) {
    return date.format('dddd, MMMM Do YYYY')
}

function describeEntry(entry, ignoreDate) {
    return `${ignoreDate ? 'You' : `On ${formatDate(entry.date)} you`} worked ${entry.hours} hours for ${entry.project}. Your entry's subject was "${entry.subject}"`;
}

function describeEntryWithoutDate(entry) {
    return describeEntry(entry, true);
}

function getIntent(alexa) {
    return alexa.event.request.intent;
}

function getAuthToken(alexa) {
    return AUTH_TOKEN_OVERRIDE || (alexa.event.session && alexa.event.session.user && alexa.event.session.user.accessToken);
}

const handlers = {
    'GetTimeEntryOnDate': function () {
        const authToken = getAuthToken(this);
        if (authToken == undefined) {
            return this.emit('NoAuthToken');
        }

        const dateToFetch = moment(this.event.request.intent.slots.Date.value);
        const formattedDateToFetch = formatDate(dateToFetch);

        return getTimeEntriesForWeekOf(authToken, dateToFetch)
            .then(entries => {
                const entry = _.find(entries || [], entry => {
                    console.log(`Comparing ${entry.date} to ${dateToFetch}`);
                    return dateToFetch.diff(entry.date) == 0;
                });

                if (!entry) {
                    return this.emit(':tell', `Looks like you don't have any entries for that day!`);
                }

                let speech = describeEntry(entry);

                this.emit(':tell', speech);
            })
            .catch(err => {
                console.log('Error: ', JSON.stringify(err));

                this.emit(':tell', `Something went wrong talking to t cube!`);
            });
    },
    'GetWeek': function () {
        const authToken = getAuthToken(this);
        if (authToken == undefined) {
            return this.emit('NoAuthToken');
        }

        const dateToFetch = moment(this.event.request.intent.slots.Date.value);
        const formattedDateToFetch = formatDate(dateToFetch);

        return getTimeEntriesForWeekOf(authToken, dateToFetch)
            .then(entries => {
                if (!entries || !entries.length) {
                    return this.emit(':tell', `Looks like you haven't entered any entries for this week!`);
                }

                let speech = `Alright, I've got your entries for the week of ${formattedDateToFetch}!`;
                const card = {
                    title: `Your work on the week of ${formattedDateToFetch}`,
                    content: ''
                };

                processEntriesForWeek(entries, dateInfo => {
                    speech += dateInfo.recommendedSpeech;
                    card.content += dateInfo.recommendedCardContent
                });

                this.emit(':tellWithCard', speech, card.title, card.content);
            })
            .catch(err => {
                console.log('Error: ', JSON.stringify(err));

                this.emit(':tell', `Something went wrong talking to t cube!`);
            });
    },
    'GetThisWeek': function () {
        const authToken = getAuthToken(this);
        if (authToken == undefined) {
            return this.emit('NoAuthToken');
        }

        // Get the time entries for the current week
        return getTimeEntriesForThisWeek(authToken)
            .then(entries => {
                if (!entries || !entries.length) {
                    return this.emit(':tell', `Looks like you haven't entered any entries for this week!`);
                }

                let speech = `Alright, I've got your entries for this week! `;
                const card = {
                    title: 'Your work week',
                    content: ''
                };

                processEntriesForWeek(entries, dateInfo => {
                    speech += dateInfo.recommendedSpeech;
                    card.content += dateInfo.recommendedCardContent
                });

                this.emit(':tellWithCard', speech, card.title, card.content);
            })
            .catch(err => {
                console.log('Error: ', JSON.stringify(err));

                this.emit(':tell', `Something went wrong talking to t cube!`);
            });
    },
    'LaunchRequest': function () {
        const authToken = getAuthToken(this);
        if (authToken == undefined) {
            return this.emit('NoAuthToken');
        }

        console.log('user: ', JSON.stringify(this.event.session.user));

        this.emit(':ask', `Welcome to T Cube! You're all logged in.`);
    },
    'NoAuthToken': function () {
        this.emit(':tellWithLinkAccountCard', `We're going to need to link your tech-know-suss account first!`);
    },
    'AMAZON.HelpIntent': function () {
        this.emit(':ask', this.attributes.speechOutput, this.attributes.repromptSpeech);
    },
    'AMAZON.RepeatIntent': function () {
        this.emit(':ask', this.attributes.speechOutput, this.attributes.repromptSpeech);
    },
    'AMAZON.StopIntent': function () {
        this.emit('SessionEndedRequest');
    },
    'AMAZON.CancelIntent': function () {
        this.emit('SessionEndedRequest');
    },
    'SessionEndedRequest': function () {
        this.emit(':tell', 'Bye!');
    },
    'Unhandled': function () {
        this.emit(':tell', "I'm not sure how to help with that");
    }
};

exports.handler = function (event, context) {
    const alexa = Alexa.handler(event, context);
    alexa.APP_ID = APP_ID;
    alexa.registerHandlers(handlers);
    alexa.execute();
};

