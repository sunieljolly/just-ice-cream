require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.static('public'));
app.use(express.json());

const stravaAuthUrl = `https://www.strava.com/oauth/authorize?client_id=${process.env.STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${process.env.STRAVA_REDIRECT_URI}&approval_prompt=force&scope=read,activity:read_all`;

app.get('/auth/strava', (req, res) => {
    res.redirect(stravaAuthUrl);
});

app.get('/auth/strava/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send('Authorization code is missing.');
    }

    try {
        const response = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                client_id: process.env.STRAVA_CLIENT_ID,
                client_secret: process.env.STRAVA_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
            }),
        });

        const data = await response.json();

        if (data.access_token) {
            const athleteName = `${data.athlete.firstname} ${data.athlete.lastname}`;
            res.redirect(`/?access_token=${data.access_token}&athlete_id=${data.athlete.id}&athlete_name=${encodeURIComponent(athleteName)}`);
        } else {
            res.status(400).send('Failed to get access token.');
        }
    } catch (error) {
        console.error('Error during Strava OAuth callback:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/api/activities', async (req, res) => {
    const { access_token, athlete_name } = req.query;

    if (!access_token) {
        return res.status(401).send('Access token is missing.');
    }

    try {
        // Fetch the last 30 activities to catch any retrospectively added ones.
        // The database's onConflict will handle duplicates.
        const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?access_token=${access_token}&page=1&per_page=30`, {
            headers: {
                Authorization: `Bearer ${access_token}`,
            },
        });

        const activities = await response.json();
        let uploadedCount = 0;

        if (activities.length > 0) {
            const activitiesToInsert = activities.map(activity => ({
                id: activity.id,
                athlete_id: activity.athlete.id,
                athlete_name: athlete_name,
                name: activity.name,
                distance: activity.distance,
                elapsed_time: activity.elapsed_time,
                start_date: activity.start_date,
                activity_type: activity.type,
                elevation_gain: activity.total_elevation_gain,
                average_heartrate: activity.average_heartrate || null, // Strava might not always provide heart rate
                total_photo_count: activity.total_photo_count || 0,
            }));

            let result;
            if (typeof supabase.from('activities').insert([]).onConflict === 'function') { // Check if onConflict is available
                result = await supabase.from('activities').insert(activitiesToInsert).onConflict('id').doNothing().select('id'); // Select 'id' to get count
            } else {
                console.error('Error: onConflict is not a function. Falling back to manual conflict handling.');
                // Manual conflict handling: Select existing IDs and filter out activities that already exist
                const { data: existingActivities, error: selectError } = await supabase
                    .from('activities')
                    .select('id')
                    .in('id', activitiesToInsert.map(a => a.id));

                if (selectError) {
                    console.error('Error checking for existing activities:', selectError);
                    return res.status(500).json({ message: 'Failed to check for existing activities.', error: selectError.message });
                }

                const existingIds = new Set(existingActivities.map(a => a.id));
                const newActivitiesToInsert = activitiesToInsert.filter(a => !existingIds.has(a.id));

                if (newActivitiesToInsert.length > 0) {
                    result = await supabase.from('activities').insert(newActivitiesToInsert).select('id'); // Select 'id' to get count
                } else {
                    result = { data: [], error: null }; // No new activities to insert
                }
            }

            if (result.error) {
                console.error('Error inserting activities into Supabase:', result.error);
                return res.status(500).json({ message: 'Failed to store activities.', error: result.error.message });
            }
            uploadedCount = result.data ? result.data.length : 0;
        }

        if (uploadedCount > 0) {
            res.json({ message: `Nice one - you just uploaded ${uploadedCount} activities!`, uploadedCount });
        } else {
            res.json({ message: 'Everything is up to date! No new activities found to upload.', uploadedCount: 0 });
        }
    } catch (error) {
        console.error('Error fetching activities from Strava:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const { data: activities, error } = await supabase
            .from('activities')
            .select('athlete_id, athlete_name, distance, elapsed_time');

        if (error) {
            console.error('Error fetching leaderboard data:', error);
            return res.status(500).send('Failed to fetch leaderboard data.');
        }

        const leaderboard = activities.reduce((acc, activity) => {
            const { athlete_id, athlete_name, distance, elapsed_time } = activity;
            if (!acc[athlete_id]) {
                acc[athlete_id] = {
                    athlete_id,
                    athlete_name,
                    activities: 0,
                    distance: 0,
                    elapsed_time: 0,
                };
            }
            acc[athlete_id].activities += 1;
            acc[athlete_id].distance += distance;
            acc[athlete_id].elapsed_time += elapsed_time;
            return acc;
        }, {});

        res.json(Object.values(leaderboard));
    } catch (error) {
        console.error('Error generating leaderboard:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/api/recent-activities', async (req, res) => {
    try {
        const { data: recentActivities, error } = await supabase
            .from('activities')
            .select('id, athlete_name, name, distance, elapsed_time, start_date, activity_type, elevation_gain, average_heartrate, total_photo_count')
            .order('start_date', { ascending: false })
            .limit(10); // Fetch the 10 most recent activities

        if (error) {
            console.error('Error fetching recent activities:', error);
            return res.status(500).send('Failed to fetch recent activities.');
        }

        res.json(recentActivities);
    } catch (error) {
        console.error('Error fetching recent activities:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Weekly Leaderboard
app.get('/weekly-leaderboard', async (req, res) => {
    try {
        // Helper function to get the start of the week (Monday)
        const getStartOfWeek = (date = new Date()) => {
            const d = new Date(date);
            const day = d.getDay(); // 0=Sun, 1=Mon, ...
            const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
            const monday = new Date(d.setDate(diff));
            monday.setHours(0, 0, 0, 0);
            return monday;
        }

        const weekQuery = req.query.week; // e.g., '2025-11-10'
        const targetDate = weekQuery ? new Date(weekQuery) : new Date();

        const startOfWeek = getStartOfWeek(targetDate);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(endOfWeek.getDate() + 7);

        const { data, error } = await supabase
            .from('activities')
            .select('*')
            .gte('start_date', startOfWeek.toISOString())
            .lt('start_date', endOfWeek.toISOString());

        if (error) {
            throw error;
        }

        const leaderboard = {};

        data.forEach(activity => {
            const athleteName = activity.athlete_name;
            if (!leaderboard[athleteName]) {
                leaderboard[athleteName] = {
                    athlete_name: athleteName,
                    points: 0,
                    walk: 0,
                    run: 0,
                    football: 0,
                    other: 0,
                };
            }

            let points = 0;
            // 1 point for a walk over 45 mins or 3 km in distance.
            if (activity.activity_type && activity.activity_type.toLowerCase() === 'walk') {
                if (activity.elapsed_time > (45 * 60) || activity.distance > 3000) {
                    points += 1;
                    leaderboard[athleteName].walk += 1;
                }
            }
            // 1 point for a run over 3 km.
            else if (activity.activity_type && activity.activity_type.toLowerCase() === 'run') {
                if (activity.distance > 3000) {
                    points += 1;
                    leaderboard[athleteName].run += 1;
                }
            }
            // Any football activity.
            else if (activity.activity_type && activity.activity_type.toLowerCase().includes('football')) {
                points += 1;
                leaderboard[athleteName].football += 1;
            }
            // Any other activity if it is over 30 mins
            else if (activity.elapsed_time > (30 * 60)) {
                points += 1;
                leaderboard[athleteName].other += 1;
            }

            leaderboard[athleteName].points += points;
        });

        const leaderboardValues = Object.values(leaderboard);

        const leaderboardWithSummary = leaderboardValues.map(athlete => {
            const summaryParts = [];
            if (athlete.walk > 0) summaryParts.push(`Walks: ${athlete.walk}`);
            if (athlete.run > 0) summaryParts.push(`Runs: ${athlete.run}`);
            if (athlete.football > 0) summaryParts.push(`Football: ${athlete.football}`);
            if (athlete.other > 0) summaryParts.push(`Other: ${athlete.other}`);
            
            return {
                athlete_name: athlete.athlete_name,
                points: athlete.points,
                summary: summaryParts.join(', ')
            };
        });

        const leaderboardArray = leaderboardWithSummary.sort((a, b) => b.points - a.points);

        res.json(leaderboardArray);
    } catch (error) {
        console.error('Error fetching weekly leaderboard data:', error);
        res.status(500).json({ error: 'Error fetching weekly leaderboard data' });
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
