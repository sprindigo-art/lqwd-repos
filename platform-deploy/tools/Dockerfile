### BUILD image
FROM python:3.9.5-slim-buster

MAINTAINER Joshua Jackson <josh@lqwd.money>

WORKDIR tools/

COPY requirements.txt requirements.txt

RUN apt-get update && apt-get -y install cron && apt-get install nano

RUN python3.9 -m pip install --upgrade pip

RUN apt-get install -y sox ffmpeg

RUN apt-get update & apt-get install -y build-essential

RUN apt-get install libcairo2

RUN apt-get install -y libcairo2-dev

#RUN apt install -y pkg-config python3-dev
#
##RUN pip3 install cairoffi
#RUN pip3 install pycairo


RUN pip3 install -r requirements.txt

COPY . /tools/
#COPY getbtcprice.py getbtcprice.py
#COPY ml_stats_daily.py ml_stats_daily.py
RUN touch scripts/config/config.py

RUN chmod -R 777 scripts

RUN mkdir logs/

# Copy cron file to the cron.d directory
COPY tools-cron /etc/cron.d/tools-cron
# Give execution rights on the cron job
RUN chmod 777 /etc/cron.d/tools-cron
# Apply cron job
RUN crontab /etc/cron.d/tools-cron

# Create the log file to be able to run tail
RUN touch /var/log/cron.log
RUN chmod 777 /var/log/cron.log

ENV WENV 1

ENV STATS_DB 2
ENV STATS_HOST 2
ENV STATS_PORT 2
ENV STATS_USER 2
ENV STATS_PASS 2

ENV ROUTING_DB 2
ENV ROUTING_HOST 2
ENV ROUTING_PORT 2
ENV ROUTING_USER 2
ENV ROUTING_PASS 2

ENV COINMARKETCAPAPI 4

ENV CLIENT_ID 7
ENV CLIENT_SECRET 8

COPY entrypoint.sh /usr/local/bin/
COPY config.sh /usr/local/bin/
RUN chmod 777 /usr/local/bin/config.sh
RUN chmod 777 /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

CMD ["/usr/local/bin/config.sh"]
