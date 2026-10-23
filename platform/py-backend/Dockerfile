FROM python:3.8-slim-buster

RUN apt-get update

# Add nanno
RUN apt-get -y install nano

RUN apt-get update
# Add Vim
RUN apt-get -y install vim

#Add postgres devel
RUN apt-get -y install libpq-dev gcc

RUN python3 -m venv /opt/venv

# Install dependencies:
COPY requirements.txt .
RUN . /opt/venv/bin/activate && pip3 install -r requirements.txt

# Run the application:
COPY app/ .
#CMD . /opt/venv/bin/activate && exec python -u client.py --debug --grpc


#copy entrypoing and init files
COPY scripts/init.sh /usr/local/bin/
COPY scripts/entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/init.sh
RUN chmod +x /usr/local/bin/entrypoint.sh


ENV APP_NAME 1
ENV BRANCH 2
ENV PROFILE 3
ENV CONFIG_FAIL_FAST 4
ENV CLIENT_ID 5
ENV CLIENT_SECRET 6
ENV KUSERPASS 7
ENV CONFIGSERVER_ADDRESS 8

ENTRYPOINT ["entrypoint.sh"]


CMD ["/usr/local/bin/init.sh", "$APP_NAME", "$BRANCH",  "$PROFILE", "$CONFIG_FAIL_FAST", "$CLIENT_ID", "$CLIENT_SECRET","$KUSERPASS","$CONFIGSERVER_ADDRESS"]
