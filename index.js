/* eslint-disable  func-names */
/* eslint quote-props: ["error", "consistent"]*/

'use strict';

const Alexa = require('alexa-sdk');
const request = require('request');
const _ = require('lodash');

const APP_ID = process.env['ASK_APPID'];
const TCUBE_API_URL = 'https://tcube.technossus.com/api/';

function makeTCubeApiUrl(url) {
    return `${TCUBE_API_URL}${url}`;
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

function getTimeEntriesForThisWeek() {
    return new Promise(function (res, rej) {
        // Get the current week's time sheet
        request.get(makeTCubeApiUrl('TimeSheet/1'), null, function (err, response, body) {
            const latestTimeSheet = body.Grid[0];

            // Get the entries in the time sheet and map them so they're easily iterable
            request.get(makeTCubeApiUrl(`TimeEntryModel/${latestTimeSheet.TimeSheetId}`), null, function (err, response, body) {
                const entries = _(body.Projects)
                    .map(function (project) {
                        const
                        return _(project.TimeEntries)
                            .filter(function (entry) {
                                return !entry.InvalidEntry;
                            })
                            .map(function (entry) {
                                return {
                                    project: project.ProjectName,
                                    date: entry.Date,
                                    subject: entry.Subject,
                                    hours: entry.Hours
                                };
                            })
                            .value();
                    })
                    .value();

                res(entries);
            });
        });
    });
}

function describeEntry(entry) {
    return `Looks like you worked ${entry.hours} hours on ${entry.date} for ${entry.project} and your entry's subject was "${entry.subject}"`;
}

function getIntent(alexa) {
    return alexa.event.request.intent;
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
        this.response.shouldEndSession(false);

        this.emit(':tell', `Alright -- let's find your time entries...`);

        return getTimeEntriesForThisWeek()
            .then(entries => {
                if (!entries || !entries.length) {
                    this.emit(':tell', `Looks like you haven't entered any entries for this week!`);

                    return this.response.shouldEndSession(true);
                }

                // Group all entries by date so we can list them
                const entriesByDate = _.groupBy(entries, function (entry) {
                    return entry.date;
                });

                // Loop through our entries and describe them
                _.forIn(entries, function (entriesForDate, date) {
                    this.emit(':tell', `Here are your entries for ${date}:`);

                    _.forEach(entriesForDate, function (entry) {
                        this.emit(':tell', describeEntry(entry));
                    });
                });

                this.response.shouldEndSession(true);
            });
    },
    'LaunchRequest': function () {
        const authToken = this.event.session.user.accessToken;
        if (authToken == undefined) {
            return this.emit(':tellWithLinkAccountCard', `We're going to need to link your Technossus account first!`);
        }

        console.log('user: ', JSON.stringify(this.event.session.user));

        this.emit(':ask', `Welcome to T Cube! You're all logged in.`);
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

