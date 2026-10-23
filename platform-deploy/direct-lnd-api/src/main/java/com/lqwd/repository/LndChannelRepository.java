package com.lqwd.repository;

import com.lqwd.model.entities.LndChannel;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Date;
import java.util.List;


@Repository
public interface LndChannelRepository extends JpaRepository<LndChannel, Long> {

    List<LndChannel> findByOpenAndChannelExpiryDateLessThan(boolean open, Date date);
}
