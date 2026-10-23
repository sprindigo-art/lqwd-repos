package com.lqwd.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.stereotype.Component;

import java.util.Map;

@Component
@Data
@ConfigurationProperties(prefix = "app")
@RefreshScope
public class AppProperties {

    private Map<String, String> lnd_node_request_mem;
    private Map<String, String> lnd_node_limit_mem;
    private String resource_id;
    private String application_notification_to;
    private String encrypt_asd;
    private String cipher_url;
    private String cipher_port;
    private String auth_post_url;
    private String auth_post_port;
    private String auth_user_name;
    private String auth_password;
    private String lnd_kafka_user;
    private String lnd_kafka_password;
    private String lnd_kafka_co_topic;
    private String lnd_kafka_co_group_id;
    private String lnd_kafka_pro_topic;
    private String lnd_debug;
    private String cipher_client_id;
    private String cipher_client_secret;
    private String frontend_base_url;
    private String node_alert_email_to;
    private String lnd_database_username;
    private String lnd_database_password;
    private String lnd_database_url;
    private long lnd_password_exp_seconds;
    private long lnd_seed_exp_seconds;
    private String redis_host;
    private int redis_port;
    private String redis_cred;
    private String staking_withdraw_email;
    private String staking_routing_lnd_node;
    private String routing_node_namespace;
    private String routing_node_name;
    private String default_lnd_cipher_password;
    private int liquidity_min_amount;
    private String liquidity_notification_emails;
    private int min_confirmation_liquidity_and_staking;
    private int lnd_min_channel_size;
    private String aws_region;
    private String aws_access_key;
    private String aws_secret_key;
    private String lnd_namespace;
    private String k8s_rpchost_regtest;
    private String k8s_rpchost_testnet;
    private String k8s_rpchost;
    private String image_path;
    private String wenv;
    private String lnd_db_port;
    private String lnd_db_host;
    private String lnd_db_port_main;
    private String lnd_db_host_main;
    private String lnd_notification_email;
    private String aws_ec2_secret_access_key;
    private String aws_ec2_access_key_id;
    private String aws_ec2_launch_template_id;
    private String lndplus_image_path;
    private String allowed_origins;
    private Map<String, Credential> btcd;
    private String billingServiceAddr;
    private String number_of_registration_users;



    @Data
    public static class Credential {

        private String username;
        private String password;
        private String host;
        private int port;

        // getters and setters

    }
}