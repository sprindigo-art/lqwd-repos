#!/bin/bash

SCRIPT_DIRECTORY="/home/ubuntu"
GIT_PROJECT_DIR="/home/ubuntu/gitrepo"

LND_DIR="/home/ubuntu/data/v3/${LND_POD_NAME}"
RUN_LND_SCRIPT=0
GIT_BRANCH="ENG-1740-liquidity-dashboard"

echo "loading github username and password from secret"
secret=$(aws secretsmanager get-secret-value --secret-id  lnd_vm_secret --region us-east-2 | jq -r ."SecretString")
GIT_USERNAME=$(echo $secret | jq -r ."GIT_USER")
GIT_PASSWORD=$(echo $secret | jq -r ."GIT_USER_TOKEN")
GIT_REPO="https://${GIT_USERNAME}:${GIT_PASSWORD}@github.com/lightningriders/platform.git"

echo "Running lnd setup/updates..."
if [ ! -d $GIT_PROJECT_DIR ];  then
  #check if project is cloned from git. if not clone it
  echo "cloning git repo"
  git clone -q $GIT_REPO $GIT_PROJECT_DIR
  cd $GIT_PROJECT_DIR

  echo "switching to appropriate version"
  git checkout $GIT_BRANCH
  cd
else
  #pull latest changes from git.
  echo "pulling from git repo to check for changes"
  cd $GIT_PROJECT_DIR
  git pull origin $GIT_BRANCH
  cd
fi

#check if directory where script runs exist
if [ ! -d $SCRIPT_DIRECTORY ];  then
  echo "Script directory does not exist going to create it"
  #create script directory
  mkdir $SCRIPT_DIRECTORY

  #copy over lnd setup script
  echo "Copy over lnd setup script"
  cp "${GIT_PROJECT_DIR}/lnd/lnd-vm/lnd_setup.sh" "${SCRIPT_DIRECTORY}/lnd_setup.sh"

  #run lnd script since seting up for the first time.
  RUN_LND_SCRIPT=1
fi

#copy over python directory if it does not exist
#if exist check if there is an update
if [ ! -d "${SCRIPT_DIRECTORY}/python/" ];  then
  #copy over lnd scripts
  cp -r "${GIT_PROJECT_DIR}/lnd/lnd-vm/python" "${SCRIPT_DIRECTORY}/python/"
else
  #check if both directories are the same
  diff=$(diff -r -q "${GIT_PROJECT_DIR}/lnd/lnd-vm/python" "${SCRIPT_DIRECTORY}/python/")
  if [ -z "$diff" ]; then
    echo "No updates to python script"
  else
    echo "There are updates to python scripts."
    #copy existing script to a new folder
    current_timestamp=$(date +%s)
    mv "${SCRIPT_DIRECTORY}/python/" "${SCRIPT_DIRECTORY}/python_${current_timestamp}/"

    #copy over lnd scripts
    cp -r "${GIT_PROJECT_DIR}/lnd/lnd-vm/python" "${SCRIPT_DIRECTORY}/python/"
  fi
fi



#check id lnd_setup script is updated.
if cmp -s "${GIT_PROJECT_DIR}/lnd/lnd-vm/lnd_setup.sh" "${SCRIPT_DIRECTORY}/lnd_setup.sh"; then
    echo "Lnd version is the same no need for updating"
else
    echo "Copy over new version of lnd setup script"
    cp "${GIT_PROJECT_DIR}/lnd/lnd-vm/lnd_setup.sh" "${SCRIPT_DIRECTORY}/lnd_setup.sh"

    #set flag to run lnd script since there is an updated version of lnd
    RUN_LND_SCRIPT=1
fi

#run lnd script if running for first time or new version of lnd was downloaded and installed
if [ $RUN_LND_SCRIPT -eq 1 ] ; then
  echo "setup new lnd"
  cd "${SCRIPT_DIRECTORY}"
  sh lnd_setup.sh

  echo "start LND script"
  cd python/
  sh lnd_cmd.sh
fi

echo "Done."