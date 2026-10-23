FROM ubuntu:20.04 as final
MAINTAINER Olufemi Thompson <olufemi@lqwd.money>

# Add build tools.
RUN apt-get update \
    && apt-get -y install nano  \
    && apt-get install net-tools \
    && apt-get -y install wget  \
    && apt-get install -y curl  \
    && apt-get -y install python3  \
    && apt-get -y install python3-pip

# Install dependencies:
COPY requirements.txt .
RUN pip3 install -r requirements.txt

#install lit
WORKDIR /litcore
ARG LNDVERSION=0.13.3-beta
ARG LITVERSION=v0.6.1-alpha
ARG install_dir=/usr/local/bin

RUN wget  https://github.com/lightninglabs/lightning-terminal/releases/download/${LITVERSION}/lightning-terminal-linux-amd64-${LITVERSION}.tar.gz \
          && tar -xvf lightning-terminal-linux-amd64-${LITVERSION}.tar.gz \
          && install -m 0755 -o root -g root -t ${install_dir} lightning-terminal-linux-amd64-${LITVERSION}/frcli \
          && install -m 0755 -o root -g root -t ${install_dir} lightning-terminal-linux-amd64-${LITVERSION}/litcli \
          && install -m 0755 -o root -g root -t ${install_dir} lightning-terminal-linux-amd64-${LITVERSION}/litd \
          && install -m 0755 -o root -g root -t ${install_dir} lightning-terminal-linux-amd64-${LITVERSION}/loop \
          && install -m 0755 -o root -g root -t ${install_dir} lightning-terminal-linux-amd64-${LITVERSION}/pool \
          && rm -r lightning-terminal-linux-amd64-${LITVERSION}/ \
          && rm -r lightning-terminal-linux-amd64-${LITVERSION}.tar.gz

EXPOSE 8443

USER root

COPY lit_cmd.sh /usr/local/bin/
COPY entrypoint.sh /usr/local/bin/

RUN ["chmod", "+x", "/usr/local/bin/lit_cmd.sh"]
RUN ["chmod", "+x", "/usr/local/bin/entrypoint.sh"]

#COPY download_lnd_files.py /usr/local/bin/
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/local/bin/lit_cmd.sh"]
