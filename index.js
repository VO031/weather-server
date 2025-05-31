const express = require("express");
const admin = require("firebase-admin");
const cron = require("node-cron");
const axios = require("axios");

const app = express();

// Initialize Firebase Admin SDK
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS || JSON.stringify(require("./serviceAccountKey.json")));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://myweb-34625-default-rtdb.firebaseio.com",
});
const database = admin.database();
const dataMuaRef = database.ref("data_mua");
const dataRef = database.ref("data");

// Function to get current date in YYYY-MM-DD format
function getCurrentDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

// Function to get current hour in 24-hour format
function getCurrentHour() {
  return new Date().getHours();
}

// Function to fetch and process precipitation
async function fetchPrecipitation() {
  const coordinates = {
    latitude: 10.5906,
    longitude: 107.2136
  };
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coordinates.latitude}&longitude=${coordinates.longitude}&hourly=precipitation&timezone=Asia/Ho_Chi_Minh`;

  try {
    const response = await axios.get(url);
    if (response.status !== 200) throw new Error(`HTTP error ${response.status}`);
    const data = response.data;

    if (data.hourly && data.hourly.precipitation) {
      const latestPrecipitation = data.hourly.precipitation[0];
      console.log("Current precipitation:", latestPrecipitation);

      // Update /data/precipitation
      const precipitationValue = typeof latestPrecipitation === "number" && !isNaN(latestPrecipitation) ? latestPrecipitation : 0;
      await dataRef.child("precipitation").set(precipitationValue);
      console.log("Precipitation sent to Firebase /data:", precipitationValue);

      // Handle /data_mua
      const snapshot = await dataMuaRef.once("value");
      const muaData = snapshot.val();
      const recordCount = muaData ? Object.keys(muaData).length : 0;
      console.log("Current number of records in data_mua:", recordCount);

      // Clear all records if it reaches 720 (30 days * 24 hours)
      if (recordCount >= 720) {
        await dataMuaRef.remove();
        console.log("Cleared all records in data_mua as it reached 720 records");
      }

      // Get current date and hour
      const today = getCurrentDate();
      const currentHour = getCurrentHour();

      // Only update the record for the current hour, no accumulation
      const hourlyPrecipitations = {};
      if (typeof latestPrecipitation === "number" && !isNaN(latestPrecipitation)) {
        hourlyPrecipitations[currentHour] = latestPrecipitation;
      }

      // Check if there's an existing record for today and this hour
      let existingRecordKey = null;
      if (muaData) {
        for (let key in muaData) {
          const record = muaData[key];
          if (record.date === today && record.hour === currentHour) {
            existingRecordKey = key;
            break;
          }
        }
      }

      // Update or create record for the current hour
      if (existingRecordKey) {
        // Update existing record for the same hour
        await dataMuaRef.child(existingRecordKey).update({
          precipitation: latestPrecipitation,
          hourlyPrecipitations: hourlyPrecipitations,
          timestamp: Date.now(),
        });
        console.log("Updated precipitation record in Firebase /data_mua:", {
          date: today,
          hour: currentHour,
          precipitation: latestPrecipitation,
          hourlyPrecipitations,
        });
      } else {
        // Create new record for the current hour
        await dataMuaRef.push({
          date: today,
          hour: currentHour,
          precipitation: latestPrecipitation,
          hourlyPrecipitations: hourlyPrecipitations,
          timestamp: Date.now(),
        });
        console.log("New precipitation record sent to Firebase /data_mua:", {
          date: today,
          hour: currentHour,
          precipitation: latestPrecipitation,
          hourlyPrecipitations,
        });
      }
    } else {
      console.warn("No precipitation data available from Open-Meteo");
    }
  } catch (error) {
    console.error("Error fetching precipitation:", error.message);
  }
}

// Schedule the task to run every hour
cron.schedule("0 * * * *", () => {
  console.log("Running precipitation fetch task...");
  fetchPrecipitation();
});

// Basic Express server
app.get("/", (req, res) => {
  res.send("Weather server is running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Run immediately on start
  fetchPrecipitation();
});