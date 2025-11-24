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
                    
                    if(activity.name.includes("PB")){
                         activityCard.classList.add('personal-best');
                    } 

                    activityCard.classList.add('activity-card');

                    const heartRateZone = getHeartRateZone(activity.average_heartrate);
                    const heartRateBadge = heartRateZone ? `<span class="badge" style="background-color: ${heartRateZone.color};">${heartRateZone.name}</span>` : '';

                    activityCard.innerHTML = `
                        <strong>${activity.name}</strong>
                        <p>by ${activity.athlete_name}</p>
                        <p>Type: ${activity.activity_type}</p>
                        <p>Distance: ${(activity.distance / 1000).toFixed(2)} km</p>
                        <p>Time: ${formatTime(activity.elapsed_time)}</p>
                        <p>Elevation Gain: ${activity.elevation_gain ? activity.elevation_gain.toFixed(0) + ' m' : 'N/A'}</p>
                        <p>Avg Heart Rate: ${activity.average_heartrate ? activity.average_heartrate.toFixed(0) + ' bpm' : 'N/A'} ${heartRateBadge}</p>
                        
                        <p>Date: ${new Date(activity.start_date_local).toLocaleDateString()}</p>
                    `;

                    //<p>Photos: ${activity.total_photo_count}</p>

                    
                    weekActivitiesContainer.appendChild(activityCard);
                });
                recentActivitiesList.appendChild(weekActivitiesContainer);
            }
        } catch (error) {
            console.error('Error fetching recent activities:', error);
            alert('Failed to fetch recent activities.');
        }
    });

    let currentWeekDate = new Date();

const fetchAndDisplayWeeklyLeaderboard = async (date) => {
    try {
        const dateString = date ? date.toISOString().split('T')[0] : '';
        const response = await fetch(`/weekly-leaderboard?week=${dateString}`);
        const data = await response.json();

        weeklyLeaderboardContent.innerHTML = '';

        const getStartOfWeek = (d) => {
            const date = new Date(d);
            const day = date.getDay();
            const diff = date.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
            const monday = new Date(date.setDate(diff));
            monday.setHours(0,0,0,0);
            return monday;
        }

        // Add navigation buttons
        const navigationDiv = document.createElement('div');
        navigationDiv.classList.add('week-navigation');

        const prevWeek = new Date(date);
        prevWeek.setDate(prevWeek.getDate() - 7);
        const prevButton = document.createElement('button');
        prevButton.textContent = '←';
        prevButton.classList.add('week-nav-button');
        prevButton.addEventListener('click', () => {
            currentWeekDate = prevWeek;
            fetchAndDisplayWeeklyLeaderboard(currentWeekDate);
        });

        const nextWeek = new Date(date);
        nextWeek.setDate(nextWeek.getDate() + 7);
        const nextButton = document.createElement('button');
        nextButton.textContent = '→';
        nextButton.classList.add('week-nav-button');
        nextButton.addEventListener('click', () => {
            currentWeekDate = nextWeek;
            fetchAndDisplayWeeklyLeaderboard(currentWeekDate);
        });

        const startOfWeek = getStartOfWeek(date);
        
        // Disable "Next Week" if it's the current week or a future week
        const today = new Date();
        const startOfCurrentWeek = getStartOfWeek(today);

        if (startOfWeek >= startOfCurrentWeek) {
            nextButton.disabled = true;
        }

        const weekOfLabel = document.createElement('h3');
        weekOfLabel.textContent = `Week of ${startOfWeek.toLocaleDateString()}`;


        navigationDiv.appendChild(prevButton);
        navigationDiv.appendChild(weekOfLabel);
        navigationDiv.appendChild(nextButton);
        weeklyLeaderboardContent.appendChild(navigationDiv);


        const table = document.createElement('table');
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Rank</th>
                    <th></th>
                    <th>Athlete</th>
                    <th>Points</th>
                    <th>Summary</th>
                </tr>
            </thead>
            <tbody>
                ${data.map((row, index) => `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${row.profile_picture_url ? `<img src="${row.profile_picture_url}" alt="${row.athlete_name}" style="width: 40px; height: 40px; border-radius: 50%;">` : ''}</td>
                        <td>${row.athlete_name}</td>
                        <td>${row.points}</td>
                        <td>${row.summary}</td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        weeklyLeaderboardContent.appendChild(table);
    } catch (error) {
        console.error('Error fetching weekly leaderboard:', error);
        alert('Failed to fetch weekly leaderboard.');
    }
};

navWeeklyLeaderboard.addEventListener('click', (e) => {
    e.preventDefault();
    showPage(weeklyLeaderboardPage);
    currentWeekDate = new Date(); // Reset to current week
    fetchAndDisplayWeeklyLeaderboard(currentWeekDate);
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

    function getHeartRateZone(hr) {
        if (!hr) return null;

        if (hr >= 160 && hr <= 178) {
            return { name: 'VO2 Max', color: '#d10000' }; // Red
        } else if (hr >= 142 && hr <= 159) {
            return { name: 'Anaerobic', color: '#ff4500' }; // OrangeRed
        } else if (hr >= 125 && hr <= 141) {
            return { name: 'Aerobic', color: '#2e8b57' }; // SeaGreen
        } else if (hr >= 107 && hr <= 124) {
            return { name: 'Fat Burn', color: '#4682b4' }; // SteelBlue
        } else if (hr >= 89 && hr <= 106) {
            return { name: 'Warm Up', color: '#6a5acd' }; // SlateBlue
        } else {
            return null;
        }
    }
});
