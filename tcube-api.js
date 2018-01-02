const request = require('request');
const _ = require('lodash');
const moment = require('moment');

const TCUBE_API_URL = process.env['TCUBE_API_URL'] || 'https://tcube.technossus.com/api/';

// Helper functions

function makeTCubeApiUrl(url) {
    const result = `${TCUBE_API_URL}${url}`;
    console.log(`Preparing to call '${result}'`);

    return result;
}

function buildTCubeRequestOptions(authToken) {
    return {
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    };
}

function getNumWeeksToFetchForDate(date) {
    console.log(`attempting to get weeks to fetch for week of ${date}`);
    console.log(`today: ${moment()}`);

    // we need to find the start of the week for date, then figure out the number of weeks from that
    const numDaysSinceStartOfWeekForTargetDate = date.days() + moment().diff(date, 'days');
    const weeksToFetch = Math.floor(numDaysSinceStartOfWeekForTargetDate / 7) + 1;

    console.log(`calculated we need ${weeksToFetch} weeks back for ${date}`);

    return weeksToFetch;
}

// Convenience functions

function getTimeEntriesForThisWeek(authToken) {
    console.log('preparing to get entries for this week');

    return getTimeEntriesForWeekOf(authToken, moment().toDate());
}

function getTimeEntriesForWeekOf(authToken, date) {
    console.log(`preparing to get time entries for week of ${date}`);

    return getTimeSheetForWeekOf(authToken, date)
        .then(sheet => getTimeEntriesForSheet(authToken, sheet.TimeSheetID));
}

function getTimeSheetForWeekOf(authToken, date) {
    console.log(`preparing to get time sheet for week of ${date}`);

    const weeksToFetch = getNumWeeksToFetchForDate(date);

    return getTimeSheetGridForLastNWeeks(authToken, weeksToFetch)
        .then(grid => {
            const sheet = _.last(grid.Grid);

            return sheet;
        });
}

// Basic functions

function getTimeEntriesForSheet(authToken, timeSheetId) {
    console.log(`Preparign to get time entries for sheet ${timeSheetId}`);

    return makeTCubeApiCall(request.get, `TimeEntryModel/${timeSheetId}`, authToken)
        .then(({ err, response, body }) => {
            if (err) {
                console.log('error getting this weeks timesheet: ', err);

                throw err;
            }

            console.log(`successfully received sheet ${timeSheetId}`);

            const sheet = JSON.parse(body);

            const entries = _(sheet.Projects)
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

            return entries;
        });
}

function getTimeSheetGridForLastNWeeks(authToken, weeksToFetch) {
    console.log(`Preparing to get time sheet grid for last ${weeksToFetch} weeks`);

    // Get the current week's time sheet
    return makeTCubeApiCall(request.get, `TimeSheet/${weeksToFetch}`, authToken)
        .then(({ err, response, body }) => {
            if (err) {
                console.log(`error getting time sheet for ${date}`, err);

                throw err;
            }

            console.log('successfully received grid');

            return JSON.parse(body);
        })
}

function createTimeEntryForProject(authToken, projectId, timeSheetId, entry) {
    return makeTCubeApiCall(request.post, `TimeEntryModel/${projectId}/${timeSheetId}`, authToken)
        .then(({ err, response, body }) => {
            if (err) {
                console.log(`error creating time entry on ${date}`, err);

                throw err;
            }

            res(body);
        });
}

function makeTCubeApiCall(verb, url, authToken) {
    return new Promise((res, rej) => {
        try {
            verb(makeTCubeApiUrl(url), buildTCubeRequestOptions(authToken), (err, response, body) => {
                console.log(`body: ${body}`);

                res({ err, response, body });
            });
        } catch (e) {
            rej(e);
        }
    });
}

module.exports = {
    makeTCubeApiUrl,
    buildTCubeRequestOptions,
    getTimeEntriesForThisWeek,
    getNumWeeksToFetchForDate,
    getTimeEntriesForWeekOf,
    getTimeSheetForWeekOf,
    getTimeEntriesForSheet,
    getTimeSheetGridForLastNWeeks,
    createTimeEntryForProject
};