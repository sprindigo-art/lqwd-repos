# Welcome to LQwD Frontend Repository
![Version](https://img.shields.io/badge/version-0.0.1-blue.svg?cacheSeconds=2592000)
[![Documentation](https://img.shields.io/badge/documentation-yes-brightgreen.svg)](https://lqwd.atlassian.net/l/c/pReebToM)
> LQwD Frontend UI for the Lightning Network

### [Production](https://lqwd.tech/)

### [Staging](https://stage.lqwd.tech:30100)

### [Develop](https://192.168.123.252:8588)

## Setup

To Install and Run Project Locally please follow step by step instructions:

* [Setup Instructions for IntelliJ Environment] (https://lqwd.atlassian.net/l/c/rLq2q0vm)
* [Configure Local Environment Variables to Run Config Server](https://lqwd.atlassian.net/l/c/9wCUBYXW)

## Deployment

For deployment Frontend is packaged as a docker container 

Build Container

```sh
docker build -t [container-name]/frontend:latest frontend_repo_root_dir/
```

Push Container

```sh
docker push [container-name]/frontend:latest
```

For more detailed deployment instruction utilizing kubernetes please see instructions here:

* [How-to Deploy Docker Image to Kubernetes](https://lqwd.atlassian.net/l/c/9BCxeKWH)

Build and Deploy Container with Jib Plug In

```sh
mvn -DCLUSTER_URL=[REGISTRY_URL] -DTAG=[IMAGE_TAG] -Dimage=[IMAGE_NAME] compile jib:build
```

## Author

**Joshua Jackson**

* Github: [@jjacks95](https://github.com/jjacks95)
