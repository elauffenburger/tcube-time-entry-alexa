/* eslint-disable  func-names */
/* eslint quote-props: ["error", "consistent"]*/

'use strict';

const Alexa = require('alexa-sdk');
const request = require('request');
const _ = require('lodash');
const moment = require('moment');

const APP_ID = process.env['ASK_APPID'];
const AUTH_TOKEN_OVERRIDE = process.env['AUTH_TOKEN_OVERRIDE'];
const TCUBE_API_URL = 'https://tcube.technossus.com/api/';

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
    return new Promise((res, rej) => {
        const requestOptions = {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        };

        // Get the current week's time sheet
        request.get(makeTCubeApiUrl('TimeSheet/1'), requestOptions, (err, response, body) => {
            if (err) {
                console.log('error getting most recent time sheet', JSON.stringify(err));
                return rej(err);
            }

            const payload = JSON.parse(body);
            const latestTimeSheet = payload.Grid[0];

            // Get the entries in the time sheet and map them so they're easily iterable
            request.get(makeTCubeApiUrl(`TimeEntryModel/${latestTimeSheet.TimeSheetID}`), requestOptions, (err, response, body) => {
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
                                    date: entry.Date,
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
    });
}

function formatDate(date) {
    return moment(date).format('dddd, MMMM Do YYYY')
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
        const intent = this.event.request.intent;
        const date = intent.slots.Date.value;

        return getTimeEntryOnDate(date)
            .then(entry => {
                this.emit(':tell', describeEntry(entry));
            });
    },
    'GetThisWeek': function () {
        const authToken = getAuthToken(this);
        if(authToken == undefined) {
            return this.emit('NoAuthToken');
        }

        // Get the time entries for the current week
        return getTimeEntriesForThisWeek(authToken)
            .then(entries => {
                if (!entries || !entries.length) {
                    return this.emit(':tell', `Looks like you haven't entered any entries for this week!`);
                }

                // Group all entries by date so we can list them
                const entriesByDate = _.groupBy(entries, entry => entry.date);

                let speech = `Alright, I've got your entries for this week! `;
                const card = {
                    title: 'Your work week',
                    content: ``
                };

                // Loop through our entries and describe them
                _.forIn(entriesByDate, (entriesForDate, date) => {
                    const formattedDate = formatDate(date);

                    // Speech for all the time entries for the current day we're looking at 
                    const speechForDay = _.reduce(entriesForDate, (acc, entry) => {
                        return `${acc}\n${describeEntryWithoutDate(entry)}.`;
                    });

                    speech += `\nHere's what you did on ${formattedDate}: ${speechForDay}`;
                    card.content += `\n\n${formattedDate}: ${_.sumBy(entriesForDate, entry => entry.hours)} hours`
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

