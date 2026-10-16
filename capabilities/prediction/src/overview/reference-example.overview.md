# weekly-orders

Predicts the orders of each region one and four weeks ahead

## What it predicts

It predicts **orders**, counted in orders, for each series a week at a time, 1 and 4 weeks ahead.

A season is 52 weeks long.

A question names a series, and one horizon when it asks for that one alone, with the value of **promotion** planned for the weeks ahead.

It answers the last 8 observed weeks and 1 and 4 weeks ahead, each with a likely value, a low and a high.

The likely value is the 50th percentile of its model, the low the 10th and the high the 90th.

## What it learns from

It learns from the rows the playbook folds from the first event of its history on:

- each time an event `order.placed` is published to the playbook

Each row is one series and one week, and holds:

- the week, from `/placed_at` in each event's data
- the series, from `/region`
- **orders**, the number of its events
- **basket**, the mean of `/total`
- **promotion**, the last value of `/promotion`, which a question gives for the weeks ahead

A build reads the last 156 weeks.

## Who trains it

Each build asks for candidate models in the playbook's inbox, as a request to **trainer**.

A build waits at most 7 days for its candidates, and the playbook then scores up to 8 of them, each within 10 minutes.

Its trainer reads the brief first, with the values of each build in place of the names in bold:

Fit a model of the weekly **target** of each of **series** regions, in **unit**,
over **window** weeks from **first** to **last**.
Predict **horizons** weeks ahead. The features are
each feature of dataset.features as **name** (**as**), separated by commas.

*For each rule of function.rules:*

- **rule**

## How a version goes live

The playbook holds back the last 12 weeks of the window from the trainer, and scores each candidate on them by its mean absolute scaled error.

A candidate passes when its interval holds at least 70% of the truths and it beats **persistence** (the last value carried forward) and **seasonal-naive** (the value one season earlier) with 90% confidence; the best that passes becomes the next version.

A version that passes becomes the active one on its own.

## Rules

Its trainer follows these rules, and the card of each version states them:

- Train on the rows given and on nothing else
