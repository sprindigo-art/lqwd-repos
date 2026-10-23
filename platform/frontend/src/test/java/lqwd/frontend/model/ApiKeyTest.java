package lqwd.frontend.model;

import static org.junit.jupiter.api.Assertions.*;

import java.util.Date;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

class ApiKeyTest {
	static ApiKey apikey;
	
	@BeforeAll
	static void init() {
		apikey = new ApiKey();
	}
	
	@Test
	void testGetApikey() {
		apikey.setApikey("test");
		assertEquals("test", apikey.getApikey());
	}

	@Test
	void testSetApikey() {
		apikey.setApikey("xyz");
		assertEquals("xyz", apikey.getApikey());
	}

	@Test
	void testGetStatus() {
		apikey.setStatus("test");
		assertEquals("test", apikey.getStatus());
	}

	@Test
	void testSetStatus() {
		apikey.setStatus("xyz");
		assertEquals("xyz", apikey.getStatus());
	}

	@Test
	void testGetCreated() {
		Date date =new Date();
		apikey.setCreated(date);
		assertEquals(date, apikey.getCreated());
	}

	@Test
	void testSetCreated() {
		Date date =new Date();
		apikey.setCreated(date);
		assertEquals(date, apikey.getCreated());
	}

	@Test
	void testGetExpired() {
		Date date =new Date();
		apikey.setExpired(date);
		assertEquals(date, apikey.getExpired());
	}

	@Test
	void testSetExpired() {
		Date date =new Date();
		apikey.setExpired(date);
		assertEquals(date, apikey.getExpired());
	}

	

}
