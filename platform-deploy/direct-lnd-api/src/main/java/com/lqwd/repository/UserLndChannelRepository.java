package com.lqwd.repository;

import com.lqwd.model.entities.UserLndChannel;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.Optional;


@Repository
public interface UserLndChannelRepository extends JpaRepository<UserLndChannel, Long>,
        JpaSpecificationExecutor<UserLndChannel> {

    Optional<UserLndChannel> findByChannelIdAndNodeName(String channelId, String nodeName);

    @Query(value = "SELECT * FROM user_lnd_channel where CAST(capacity AS INT) > :capacity AND node_name =:nodeName " +
            "AND user_id =:userId AND active =:active AND remote_pub_key= :remotePubkey LIMIT 1", nativeQuery = true)
    Optional<UserLndChannel> findChannelByPubKeyAndCapacity(String userId,
                                                                    String nodeName, String remotePubkey,
                                                                             boolean active, int capacity);

    boolean existsByChannelIdAndNodeName(String channelId, String nodeName);

    Optional<UserLndChannel> findByChannelPointAndNodeName(String channelPoint, String nodeName);
}
