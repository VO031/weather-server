const express = require("express");
const admin = require("firebase-admin");
const cron = require("node-cron");
const axios = require("axios");

const app = express();

// Initialize Firebase Admin SDK
const serviceAccount = require("./serviceAccountKey.json"); // Thay bằng env variable nếu cần
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
    latitude: 10.3678, // Suối Nghệ, Châu Đức, BRVT
    longitude: 107.0989,
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

      // Clear all records if it reaches 30
      if (recordCount >= 30) {
        await dataMuaRef.remove();
        console.log("Cleared all records in data_mua as it reached 30 records");
      }

      // Calculate total precipitation for today
      const today = getCurrentDate();
      const currentHour = getCurrentHour();
      const hourlyPrecipitations = {};

      // Initialize with the latest precipitation
      if (typeof latestPrecipitation === "number" && !isNaN(latestPrecipitation)) {
        hourlyPrecipitations[currentHour] = latestPrecipitation;
      }

      // Collect existing precipitation records for today
      if (muaData) {
        for (let key in muaData) {
          const record = muaData[key];
          if (record.date === today && record.hourlyPrecipitations) {
            // Copy all hourly precipitations from existing record, except for current hour
            for (let hour in record.hourlyPrecipitations) {
              if (parseInt(hour) !== currentHour) {
                hourlyPrecipitations[hour] = parseFloat(record.hourlyPrecipitations[hour]) || 0;
              }
            }
          }
        }
      }

      // Calculate total precipitation for today
      const totalPrecipitationToday = Object.values(hourlyPrecipitations).reduce((sum, prec) => sum + prec, 0);

      // Remove all existing records for today
      if (muaData) {
        const updates = {};
        for (let key in muaData) {
          if (muaData[key].date === today) {
            updates[key] = null;
          }
        }
        if (Object.keys(updates).length > 0) {
          await dataMuaRef.update(updates);
          console.log("Removed existing records for today:", today);
        }
      }

      // Add new record
      await dataMuaRef.push({
        date: today,
        hour: currentHour,
        precipitation: totalPrecipitationToday,
        hourlyPrecipitations: hourlyPrecipitations,
        timestamp: Date.now(),
      });
      console.log("New precipitation record sent to Firebase /data_mua:", {
        date: today,
        hour: currentHour,
        precipitation: totalPrecipitationToday,
        hourlyPrecipitations,
      });
    } else {
      console.warn("No precipitation data available from Open-Meteo");
    }
  } catch (error) {
    console.error("Error fetching precipitation:", error.message);
  }
}

// Schedule the task to run every 10 minutes
cron.schedule("*/10 * * * *", () => {
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