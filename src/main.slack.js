const { RTMClient } = require("@slack/client");
const { exec } = require("child_process");
const { fromEventPattern, fromEvent, of } = require("rxjs");
const {
  filter,
  groupBy,
  map,
  mergeMap,
  share,
  tap,
  throttleTime
} = require("rxjs/operators");
require("dotenv").config();

const client = new RTMClient(process.env.SLACK_TOKEN);
client.start();
const regex = /`{3}([\s\S]*)`{3}/;

const message$ = fromEvent(client, "message");

message$
  .pipe(filter(message => /^\?h[ea]lp$/.test(message.text)))
  .subscribe(message => {
    client.sendMessage(
      "Need some help evaluating your hacky code? Ooof. Send a message like\n?eval\n\\```\nput your code here\n\\```",
      message.channel
    );
  });

message$
  .pipe(
    filter(message => /^\?eval/.test(message.text)),
    groupBy(message => message.user),
    mergeMap(msg$ => msg$.pipe(throttleTime(30 * 1000))),
    mergeMap(message =>
      of(message).pipe(
        map(msg => msg.text.match(regex)),
        filter(matches => Array.isArray(matches) && matches.length === 2),
        map(matches => matches[1]),
        map(code => Buffer.from(code).toString("base64")),
        tap(() => console.log("?!?!?!?!")),
        mergeMap(encoded =>
          fromEventPattern(handler => {
            exec(
              `deno <( echo -e "['libdeno','deno','compilerMain'].forEach(p=>delete window[p]);console.log(eval(window.atob('${encoded}')))" )`,
              { timeout: 2000, shell: "/bin/bash" },
              handler
            );
          })
        ),
        map(result => result.concat(message))
      )
    ),
    tap(console.log)
  )
  .subscribe(
    ([error, stdout, stderr, message]) => {
      const res = stderr.length ? stderr : stdout;

      if ((error && error.killed) || res.length > 500) {
        client.sendMessage("tl;dr", message.channel);
        return;
      }

      client.sendMessage(
        error ? error.message.split(/\r?\n/)[1] : res,
        message.channel
      );
    },
    error => {
      console.log(error);
    }
  );
