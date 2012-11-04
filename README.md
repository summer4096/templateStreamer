templateStreamer
================

A templating engine that sends data as soon as possible

(for node)

It's in development right now, but if you do "node runner.js" you'll get the gist of how it works.

It doesn't actually parse template strings yet, but instead works with compiled data.

Instead of the traditional put-data-in-get-strings-out business, this instead works as a stream. You begin rendering the template immediately, providing it with data when it becomes available to you.

Old and busted:
1. recieve request for list of search results
2. verify validity of request
3. begin the search
4. wait for all results to come in
5. send them to the template engine, getting a string back
6. send that string to the client

New hotness:
1. recieve request for list of search results
2. begin sending template, output stops when more data is required to continue
3. verify validity of request
4. begin the search
5. send search results to client as they come in
6. profot

As a result, pages load much more quickly, because everything is done at once. The user starts downloading the page before the server-side logic even begins.
