document.addEventListener('DOMContentLoaded', () => {
    const menuToggle = document.querySelector('.menu-toggle');
    const navLinks = document.querySelector('.nav-links');

    menuToggle.addEventListener('click', () => {
        navLinks.classList.toggle('active');
    });

    const homePage = document.getElementById('home-page');
    const uploadActivitiesPage = document.getElementById('upload-activities-page');
    const recentActivitiesPage = document.getElementById('recent-activities-page');
    const weeklyLeaderboardPage = document.getElementById('weekly-leaderboard-page');


    const navHome = document.getElementById('nav-home');
    const navUploadActivities = document.getElementById('nav-upload-activities');
    const navRecentActivities = document.getElementById('nav-recent-activities');
    const navWeeklyLeaderboard = document.getElementById('nav-weekly-leaderboard');


    const authStravaButton = document.getElementById('connect-strava-button');
    const uploadButton = document.getElementById('upload-button');
    const uploadInstructions = document.getElementById('upload-instructions');
    const recentActivitiesList = document.getElementById('recent-activities-list');
    const weeklyLeaderboardContent = document.getElementById('weekly-leaderboard-content');


    const urlParams = new URLSearchParams(window.location.search);
    const accessToken = urlParams.get('access_token');
    const athleteId = urlParams.get('athlete_id');
    const athleteName = urlParams.get('athlete_name');

    const updateUploadInstructions = (isAuthenticated) => {
        if (isAuthenticated) {
            uploadInstructions.innerHTML = `
                <p><strong>Step 2:</strong> You are connected to Strava as <strong>${decodeURIComponent(athleteName)}</strong>.</p>
                <p>Click the button below to upload your recent activities to the leaderboard.</p>
                <div id="upload-feedback" style="margin-top: 10px; font-weight: bold;"></div>
            `;
            authStravaButton.style.display = 'none';
            uploadButton.style.display = 'inline-block';
        } else {
            uploadInstructions.innerHTML = `
                <p><strong>Step 1:</strong> Connect your Strava account to allow us to access your activities.</p>
                <p>Click the button below to authorize with Strava.</p>
                <div id="upload-feedback" style="margin-top: 10px; font-weight: bold;"></div>
            `;
            authStravaButton.style.display = 'inline-block';
            uploadButton.style.display = 'none';
        }
    };

    const showPage = (pageToShow) => {
        homePage.style.display = 'none';
        uploadActivitiesPage.style.display = 'none';
        recentActivitiesPage.style.display = 'none';
        weeklyLeaderboardPage.style.display = 'none';

        pageToShow.style.display = 'block';

        // Close the mobile menu if it's open
        navLinks.classList.remove('active');
    };

    // Initial page load
    if (accessToken && athleteId && athleteName) {
        showPage(uploadActivitiesPage);
        updateUploadInstructions(true);
    } else {
        showPage(homePage);
    }

    navHome.addEventListener('click', (e) => {
        e.preventDefault();
        showPage(homePage);
    });

    navUploadActivities.addEventListener('click', (e) => {
        e.preventDefault();
        showPage(uploadActivitiesPage);
        updateUploadInstructions(accessToken && athleteId && athleteName);
    });

    navRecentActivities.addEventListener('click', async (e) => {
        e.preventDefault();
        showPage(recentActivitiesPage);
        try {
            const response = await fetch('/api/recent-activities');
            const data = await response.json();

            recentActivitiesList.innerHTML = '';

            const activitiesByWeek = data.reduce((acc, activity) => {
                const activityDate = new Date(activity.start_date);
                const mondayOfWeek = getMondayOfWeek(activityDate);
                const weekString = mondayOfWeek.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

                if (!acc[weekString]) {
                    acc[weekString] = [];
                }
                acc[weekString].push(activity);
                return acc;
            }, {});

            for (const weekString in activitiesByWeek) {
                const weekHeading = document.createElement('h3');
                weekHeading.textContent = `Week of ${weekString}`;
                recentActivitiesList.appendChild(weekHeading);

                const weekActivitiesContainer = document.createElement('div');
                weekActivitiesContainer.classList.add('recent-activities-grid'); // Reuse the grid class
                activitiesByWeek[weekString].forEach(activity => {
                    const activityCard = document.createElement('div');
                    activityCard.classList.add('activity-card');
                    activityCard.innerHTML = `
                        <strong>${activity.name}</strong>
                        <p>by ${activity.athlete_name}</p>
                        <p>Type: ${activity.activity_type}</p>
                        <p>Distance: ${(activity.distance / 1000).toFixed(2)} km</p>
                        <p>Time: ${formatTime(activity.elapsed_time)}</p>
                        <p>Elevation Gain: ${activity.elevation_gain ? activity.elevation_gain.toFixed(0) + ' m' : 'N/A'}</p>
                        <p>Avg Heart Rate: ${activity.average_heartrate ? activity.average_heartrate.toFixed(0) + ' bpm' : 'N/A'}</p>
                        <p>Photos: ${activity.total_photo_count}</p>
                        <p>Date: ${new Date(activity.start_date).toLocaleDateString()}</p>
                    `;
                    weekActivitiesContainer.appendChild(activityCard);
                });
                recentActivitiesList.appendChild(weekActivitiesContainer);
            }
        } catch (error) {
            console.error('Error fetching recent activities:', error);
            alert('Failed to fetch recent activities.');
        }
    });

    navWeeklyLeaderboard.addEventListener('click', async (e) => {
        e.preventDefault();
        showPage(weeklyLeaderboardPage);
        try {
            const response = await fetch('/api/weekly-leaderboard');
            const data = await response.json();

            weeklyLeaderboardContent.innerHTML = '';

            data.forEach(weekData => {
                const weekHeading = document.createElement('h3');
                weekHeading.textContent = `Week of ${new Date(weekData.week).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;
                weeklyLeaderboardContent.appendChild(weekHeading);

                const table = document.createElement('table');
                table.innerHTML = `
                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th>Athlete Name</th>
                            <th>Points (Total)</th>
                            <th>Walk</th>
                            <th>Run</th>
                            <th>Football</th>
                            <th>Other</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${weekData.athletes.map((athlete, index) => `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${athlete.athlete_name}</td>
                                <td>${athlete.points.total}</td>
                                <td>${athlete.points.walk}</td>
                                <td>${athlete.points.run}</td>
                                <td>${athlete.points.football}</td>
                                <td>${athlete.points.other}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                `;
                weeklyLeaderboardContent.appendChild(table);
            });
        } catch (error) {
            console.error('Error fetching weekly leaderboard:', error);
            alert('Failed to fetch weekly leaderboard.');
        }
    });



    if (accessToken) {
        uploadButton.addEventListener('click', async (e) => {
            e.preventDefault();
            try {
                const response = await fetch(`/api/activities?access_token=${accessToken}&athlete_name=${athleteName}`);
                const data = await response.json();
                const uploadFeedback = document.getElementById('upload-feedback');
                if (data.uploadedCount > 0) {
                    uploadFeedback.textContent = `Success: ${data.message}`;
                    uploadFeedback.style.color = 'green';
                } else {
                    uploadFeedback.textContent = `Info: ${data.message}`;
                    uploadFeedback.style.color = 'blue';
                }
            } catch (error) {
                console.error('Error uploading activities:', error);
                const uploadFeedback = document.getElementById('upload-feedback');
                uploadFeedback.textContent = `Error: Failed to upload activities.`;
                uploadFeedback.style.color = 'red';
            }
        });
    }

    function formatTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;

        const pad = (num) => num < 10 ? '0' + num : num;

        return `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
    }

    function getMondayOfWeek(date) {
        const d = new Date(date);
        const day = d.getDay(); // 0 for Sunday, 1 for Monday, ..., 6 for Saturday
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust if day is Sunday
        const monday = new Date(d.setDate(diff));
        monday.setHours(0, 0, 0, 0); // Set to start of the day (local time)
        return monday;
    }
});
