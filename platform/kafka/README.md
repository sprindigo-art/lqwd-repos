# dockerkafka
dockerzookeeper

Docker container for zookeeper Docker image location is localhost:5000/kafkaz:latest


Run in background : sudo docker run -d -p 2181:2818 -p 2888:2888 -p 3888:3888 localhost:5000/kafkaz:latest


config file location: /otp/zookeeper/conf/zoo.cfg


configuration parameters: //The number of milliseconds of each tick tickTime=2000 //The number of ticks that the initial synchronization phase can take initLimit=10 //The number of ticks that can pass between sending a request and getting an acknowledgement syncLimit=5 //the directory where the snapshot is stored. do not use /tmp for storage, /tmp here is just example sakes. dataDir=/tmp/zookeeper // the port at which the clients will connect clientPort=2181



kafka node

Docker container for zookeeper Docker image location is localhost:5000/kafkan:latest

Run in background : sudo docker run -d localhost:5000/kafkan:latest (next version will add id env)


config parameters: 
broker.id
log.dirs
offset.topic.num.parttions
offset.topic.replication.factor
zookeeper.connect ip:port

