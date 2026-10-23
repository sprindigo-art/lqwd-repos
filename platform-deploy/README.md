# platform

## Configuration server
Build and push to container registry using the google jib plugin
```
$ cd configuration-server
$ mvn -DGIT_USERNAME=xxxx -DGIT_PASSWORD=xxxx -DCLUSTER_URL=xxxx -DTAG=xxxx compile jib:build
```
This will build the docker image and upload the image to the registry specified.

N/B the image name in the registry has been configured to use the project.artifactId
