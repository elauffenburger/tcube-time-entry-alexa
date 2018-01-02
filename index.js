/* eslint-disable  func-names */
/* eslint quote-props: ["error", "consistent"]*/

'use strict';

const Alexa = require('alexa-sdk');
const _ = require('lodash');
const moment = require('moment');

const tcube = require('./tcube-api');

const APP_ID = process.env['ASK_APPID'];
const AUTH_TOKEN_OVERRIDE = process.env['AUTH_TOKEN_OVERRIDE'];

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

function handleTCubeError(err) {
    console.log(`Error: ${err}`);

    this.emit(':tell', 'Something went wrong talking to T Cube!');
}

function processEntriesForWeek(entries, onSpeechGeneratedForDay) {
    // Group all entries by date so we can list them
    const entriesByDate = _.groupBy(entries, entry => entry.date);

    // Loop through our entries and describe them
    _.forIn(entriesByDate, (entriesForDate, date) => {
        const formattedDate = formatDate(moment(date));
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

const handlers = {
    'AddEntryOnDate': function () {
        const authToken = getAuthToken(this);
        if (authToken == undefined) {
            return this.emit('NoAuthToken');
        }

        const date = moment(this.event.request.intent.slots.Date.value);
        const formattedDateToFetch = formatDate(date);

        const hours = this.event.request.intent.slots.Hours.value;
        const subject = this.event.request.intent.slots.Subject.value;

        // TODO: figure out how to make this dynamic
        //const projectName = this.event.request.intent.slots.Project.value;
        const projectName = "Dedicated Team - 12 months";

        return tcube.getTimeSheetForWeekOf(authToken, date)
            .then(sheet => {
                const project = _.find(sheet.Projects, project => project.ProjectName == projectName);

                const entry = {
                    Subject: subject,
                    Description: subject,
                    Hours: hours,
                    Date: date
                };

                return tcube.createTimeEntryForProject(authToken, projectId, timeSheetId, entry)
                    .then(createdEntry => {
                        console.log(`Created entry: ${JSON.stringify(createdEntry)}`);

                        this.emit(':tell', "Done...I think?");
                    });
            });
    },
    'GetTimeEntryOnDate': function () {
        const authToken = getAuthToken(this);
        if (authToken == undefined) {
            return this.emit('NoAuthToken');
        }

        const dateToFetch = moment(this.event.request.intent.slots.Date.value);
        const formattedDateToFetch = formatDate(dateToFetch);

        return tcube.getTimeEntriesForWeekOf(authToken, dateToFetch)
            .then(entries => {
                entries = entries || [];

                console.log(`received ${entries.length} entries for ${formattedDateToFetch}`);

                const entry = _.find(entries, entry => {
                    console.log(`Comparing ${entry.date} to ${dateToFetch}`);
                    return dateToFetch.diff(entry.date) == 0;
                });

                if (!entry) {
                    console.log(`failed to find an entry for ${formattedDateToFetch}`);

                    return this.emit(':tell', `Looks like you don't have any entries for that day!`);
                }

                console.log(`found an entry for ${formattedDateToFetch}`);

                let speech = describeEntry(entry);

                this.emit(':tell', speech);
            })
            .catch(handleTCubeError.bind(this));
    },
    'GetWeek': function () {
        const authToken = getAuthToken(this);
        if (authToken == undefined) {
            return this.emit('NoAuthToken');
        }

        const dateToFetch = moment(this.event.request.intent.slots.Date.value);
        const formattedDateToFetch = formatDate(dateToFetch);

        return tcube.getTimeEntriesForWeekOf(authToken, dateToFetch)
            .then(entries => {
                if (!entries || !entries.length) {
                    return this.emit(':tell', `Looks like you haven't entered any entries for the week of ${formattedDateToFetch}`);
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
            .catch(handleTCubeError.bind(this));
    },
    'GetThisWeek': function () {
        const authToken = getAuthToken(this);
        if (authToken == undefined) {
            return this.emit('NoAuthToken');
        }

        // Get the time entries for the current week
        return tcube.getTimeEntriesForThisWeek(authToken)
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
            .catch(handleTCubeError.bind(this));
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
    alexa.appId = APP_ID;
    alexa.registerHandlers(handlers);
    alexa.execute();
};

