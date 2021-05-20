const m3u8parser = require("m3u8-parser");
const fetch = require("node-fetch").default;
const { join } = require("path");
const { spawn, exec } = require("child_process");
const fs = require("fs");

const decryptionKey = "decryption key";

const masterPlaylist = "m3u8 url";

const outputFileName = "Andromeda.S05.E07.Attempting.Screed.mp4";

const baseUrl = masterPlaylist.slice(0, masterPlaylist.lastIndexOf("/")) + "/";

function fetchPlaylist(url) {
  return new Promise((resolve, reject) => {
    fetch(url)
      .then(async (res) => {
        if (res.ok) {
          resolve(await res.text());
        } else {
          reject(res.statusText);
        }
      })
      .catch(reject);
  });
}

function parse(text) {
  const parser = new m3u8parser.Parser();
  parser.push(text);
  parser.end();
  return parser;
}

function printProgress(progress) {
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  process.stdout.write(progress);
}

const download = (url, dir, file) => {
  return new Promise((resolve, reject) => {
    const child = spawn("aria2c", [
      "--auto-file-renaming=false",
      "-c",
      "-j16",
      "-x16",
      "-s16",
      "-d",
      dir,
      "-o",
      file,
      url,
    ]);
    child.stdout.on("data", (data) => {
      printProgress(data.toString());
    });
    child.stderr.on("data", (data) => {
      printProgress(data.toString());
    });
    child.on("error", (err) => printProgress(err.toString()));
    child.on("message", (msg, _) => printProgress(msg));
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(`aria2c exited with code ${code}`);
      }
      resolve();
    });
  });
};

(async () => {
  const masterManifestText = await fetchPlaylist(masterPlaylist);

  const masterManifest = parse(masterManifestText);

  const audioUrl =
    baseUrl +
    masterManifest.manifest.mediaGroups.AUDIO["default-audio-group"]["stream_0"]
      .uri;
  const videoGroup =
    masterManifest.manifest.playlists[
      masterManifest.manifest.playlists.length - 1
    ];
  const videoUrl = baseUrl + videoGroup.uri;

  // process audio
  const audioManifestText = await fetchPlaylist(audioUrl);
  const audioManifest = parse(audioManifestText);
  // const audioKID =
  //   audioManifest.manifest.contentProtection["com.widevine.alpha"].attributes
  //     .keyId;

  const audioSegmentUrl = baseUrl + audioManifest.manifest.segments[0].uri;

  const encryptedAudioFilePath = join(
    __dirname,
    "temp",
    audioManifest.manifest.segments[0].uri
  );

  const decryptedAudioFilePath = join(
    __dirname,
    "temp",
    `${audioManifest.manifest.segments[0].uri.split(".mp4")[0]}_decrypted.mp4`
  );

  await download(
    audioSegmentUrl,
    join(__dirname, "temp"),
    audioManifest.manifest.segments[0].uri
  ).catch(console.error);

  const child = exec(
    `mp4decrypt --key 1:${decryptionKey} "${encryptedAudioFilePath}" "${decryptedAudioFilePath}"`
  );
  child.on("error", (err) => {
    console.error(err);
  });
  child.on("message", (msg, _) => {
    console.log(msg);
  });
  child.on("exit", async (code) => {
    if (code !== 0) {
      console.error(`mp4decrypt (audio) exited with code ${code}`);
      process.exit(code);
    }

    console.log(`Audio decryption complete`);

    // process video
    const videoManifestText = await fetchPlaylist(baseUrl + videoGroup.uri);
    const videoManifest = parse(videoManifestText);
    const videoSegmentUrl = baseUrl + videoManifest.manifest.segments[0].uri;

    const encryptedVideoFilePath = join(
      __dirname,
      "temp",
      videoManifest.manifest.segments[0].uri
    );

    const decryptedVideoFilePath = join(
      __dirname,
      "temp",
      `${videoManifest.manifest.segments[0].uri.split(".mp4")[0]}_decrypted.mp4`
    );

    await download(
      videoSegmentUrl,
      join(__dirname, "temp"),
      videoManifest.manifest.segments[0].uri
    ).catch(console.error);

    const child2 = exec(
      `mp4decrypt --key 1:${decryptionKey} "${encryptedVideoFilePath}" "${decryptedVideoFilePath}"`
    );
    child2.on("error", (err) => {
      console.error(err);
    });
    child2.on("message", (msg, _) => {
      console.log(msg);
    });
    child2.on("exit", async (code) => {
      if (code !== 0) {
        console.error(`mp4decrypt (video) exited with code ${code}`);
        process.exit(code);
      }

      console.log(`Video decryption complete`);

      const outputPath = join(__dirname, outputFileName);
      // merge
      const ffmpegChild = spawn("ffmpeg", [
        "-i",
        `${decryptedAudioFilePath}`,
        "-i",
        `${decryptedVideoFilePath}`,
        "-c",
        "copy",
        `${outputPath}`,
      ]);
      console.log(ffmpegChild.spawnargs.join(" "));
      ffmpegChild.stdout.on("data", (data) => {
        console.log(data.toString());
      });
      ffmpegChild.stderr.on("data", (data) => {
        console.error(data.toString());
      });
      ffmpegChild.on("error", (err) => console.error(err));
      ffmpegChild.on("message", (msg, _) => console.log(msg));
      ffmpegChild.on("exit", (code) => {
        if (code !== 0) {
          console.error(`ffmpeg exited with code ${code}`);
          process.exit(code);
        }

        console.log(`Download complete`);
        fs.unlink(encryptedAudioFilePath, () =>
          console.log("Audio temp file deleted")
        );
        fs.unlink(encryptedVideoFilePath, () =>
          console.log("Video temp file deleted")
        );
        fs.unlink(decryptedAudioFilePath, () =>
          console.log("decrypted audio temp file deleted")
        );
        fs.unlink(decryptedVideoFilePath, () =>
          console.log("decrypted video temp file deleted")
        );
      });
    });
  });
})();
