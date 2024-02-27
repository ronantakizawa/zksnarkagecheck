const express = require('express');
const fs = require('fs').promises;
const fs2 = require('fs');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const snarkjs = require('snarkjs'); 
const { exec } = require("child_process");

const app = express();
const port = process.env.PORT || 8080; // Prefer environment variable for port

// Apply Helmet for basic security practices
app.use(helmet());

// Enable CORS with default settings
const corsOptions = {
  origin: 'http://localhost:3000',
  methods: 'POST',
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
};
app.use(cors(corsOptions));

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Parse JSON bodies (as sent by API clients)
app.use(express.json());

// Securely handle the creation of a new user password
app.post('/set-password', async (req, res) => {
  const { newEmail, newPassword } = req.body;
  const providerUUID = req.headers['uuid'];
  const newDirPath = path.join(providerUUID);
  const newDirPathEmail = path.join(providerUUID+"/"+newEmail);

  if (!fs2.existsSync(newDirPath)) {
    return res.status(400).json({ message: "Your authentication provider doesn't have an account with ZK Auth set up. Please notify them." });
  }
  if (fs2.existsSync(newDirPathEmail)) {
    return res.status(404).json({ message: "Email already taken" });
  }

  try {
    const passwordToNum = BigInt(stringToAsciiConcatenated(newPassword));
    await fs.mkdir(newDirPathEmail, { recursive: true });
    const filesToCopy = ['setup.sh', 'pot14_final.ptau', 'circuit_final.zkey'];
    for (const file of filesToCopy) {
      await fs.copyFile(file, path.join(newDirPathEmail, file));
    }

    let setupFileContents = await fs.readFile(path.join(newDirPathEmail, "setup.sh"), 'utf8');
    setupFileContents = setupFileContents.replace(/var password = \d+;/, `var password = ${passwordToNum};`);
    await fs.writeFile(path.join(newDirPathEmail, "setup.sh"), setupFileContents, 'utf8');
    exec(`./setup.sh`, { cwd: newDirPathEmail }, (error, stdout, stderr) => {
      if (error) {
        console.error(`exec error: ${error}`);
        return res.status(500).send('Error executing setup script');
      }
      console.log(`stdout: ${stdout}`);
      
      // Respond to the request indicating success
      res.json({ message: "Password setup successfully" });
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.post('/check-password', async (req, res) => {
  const { emailAttempt, passwordAttempt } = req.body;
  const providerUUID = req.headers['uuid'];
  const newDirPath = path.join(providerUUID);
  const newDirPathEmail = path.join(providerUUID+"/"+emailAttempt);

  if (!fs2.existsSync(newDirPath)) {
    return res.status(400).json({ message: "Your authentication provider doesn't have an account with ZK Auth set up. Please notify them." });
  }
  if (!fs2.existsSync(newDirPathEmail)) {
    return res.status(404).json({ message: "Invalid email address" });
  }

  try {
    const message = await run(providerUUID, emailAttempt, passwordAttempt);
    res.status(200).json({ message: message});
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'An error occurred'});
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});

async function run(providerUUID,emailAttempt, passwordAttempt) {
  const passwordNum = stringToAsciiConcatenated(passwordAttempt);
  let message = "";

  const { publicSignals } = await snarkjs.plonk.fullProve({ attempt: passwordNum }, `./${providerUUID}/${emailAttempt}/circuit.wasm`, `./${providerUUID}/${emailAttempt}/circuit_final.zkey`);
  const result = publicSignals[0] === '1' ? "Login Successful!" : "Incorrect Password";
  message += result + "\n";

  return message;
}

function stringToAsciiConcatenated(inputString) {
  let asciiConcatenated = '';
  for (let i = 0; i < inputString.length; i++) {
    asciiConcatenated += inputString.charCodeAt(i).toString();
  }
  return asciiConcatenated;
}
